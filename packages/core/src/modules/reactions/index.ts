import * as z from "zod";
import type { Actor } from "../../actor";
import { requireAuthenticated } from "../../actor";
import { type Ctx, cached, invalidate, prepared } from "../../context";
import {
  reactionsList,
  reactionsRemove,
  reactionsSet,
  reactionTypesCreate,
  reactionTypesList,
  reactionTypesUpdate,
} from "../../contracts/reactions";
import type { ReactionContentType } from "../../db/schema";
import { writeTx } from "../../db/tx";
import { ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { publishEvent } from "../../events";
import type { Language } from "../../i18n";
import { implement } from "../../operation";
import { decodeCursor, encodeCursor } from "../../pagination";
import { can, getNodeTree, requirePermission } from "../../permissions";
import {
  actorFacts,
  assertRule,
  evaluate,
  measuredCriteria,
  parseRule,
  type Rule,
} from "../../shared/criteria";
import { lockHint } from "../../shared/criteria/hint";
import { viewerLanguage } from "../../shared/language";
import { parseReactionCounts, reactionSummary } from "../../shared/reactions";
import { loadUserSummaries } from "../../shared/users";
import { iso } from "../../time";
import { reactableConversationMessage } from "../conversations";
import { reactablePost } from "../forums";
import { attachUploadedFile, releaseFile } from "../images/attach";
import { requireSiteView } from "../members/site-access";
import { appendModeratorLog, requireNegativeReactionRoom } from "../moderation";
import { requireTermsAccepted } from "../pages/acceptance";
import { reactableProfileComment, reactableProfilePost } from "../profiles";
import { publicPicture } from "../storage/url";

type TypeRow = {
  id: number;
  title: string;
  emoji: string;
  score: number;
  position: number;
  is_active: number;
  image_file_id: number | null;
  frame_width: number | null;
  frame_height: number | null;
  frame_count: number;
  rule: string;
  forum_ids: string;
  hide_when_locked: number;
};
type ReactionRow = {
  id: number;
  user_id: number;
  reaction_type_id: number;
  score: number;
  created_at: number;
};
const tables: Record<ReactionContentType, string> = {
  post: "posts",
  profile_post: "profile_posts",
  profile_post_comment: "profile_post_comments",
  conversation_message: "conversation_messages",
};
const reactables = {
  post: reactablePost,
  profile_post: reactableProfilePost,
  profile_post_comment: reactableProfileComment,
  conversation_message: reactableConversationMessage,
};
export const existingSql =
  "SELECT id, user_id, reaction_type_id, score, created_at FROM reactions WHERE content_type = ?1 AND content_id = ?2 AND user_id = ?3";
export const listSql =
  "SELECT id, user_id, reaction_type_id, score, created_at FROM reactions WHERE content_type = ?1 AND content_id = ?2 AND user_id > ?3 ORDER BY user_id LIMIT ?4";

const typeColumns =
  "id, title, emoji, score, position, is_active, image_file_id, frame_width, frame_height, frame_count, rule, forum_ids, hide_when_locked";

function fileRow(ctx: Ctx, fileId: number) {
  return prepared(ctx, "reactions.fileSize", () =>
    ctx.sqlite.prepare<{ width: number | null; height: number | null }, [number]>(
      "SELECT width, height FROM files WHERE id = ?1 AND deleted_at IS NULL",
    ),
  ).get(fileId);
}
function fileSize(ctx: Ctx, fileId: number) {
  const file = fileRow(ctx, fileId);
  if (!file?.width || !file.height) throw new ValidationError("The picture could not be measured.");
  return { width: file.width, height: file.height };
}
/** A type as every viewer sees it; the viewer's own standing is added by `forViewer`. */
function typeValue(ctx: Ctx, r: TypeRow) {
  // A public read: a picture whose file is gone is left out, the emoji stays.
  const file = r.image_file_id === null ? undefined : fileRow(ctx, r.image_file_id);
  const imageFileId = file ? r.image_file_id : null;
  const frames =
    file?.width && r.frame_width !== null && r.frame_height !== null
      ? {
          width: r.frame_width,
          height: r.frame_height,
          count: r.frame_count,
          columns: Math.floor(file.width / r.frame_width),
        }
      : null;
  return {
    id: r.id,
    title: r.title,
    emoji: r.emoji,
    score: r.score,
    position: r.position,
    isActive: !!r.is_active,
    image: publicPicture(ctx, imageFileId),
    frames,
    forumIds: JSON.parse(r.forum_ids) as number[],
    hideWhenLocked: !!r.hide_when_locked,
  };
}
type TypeValue = ReturnType<typeof typeValue>;
/** A type with the rule it is given by, as kept in the cache. */
type Listed = { value: TypeValue; rule: Rule };
const listed = (ctx: Ctx, row: TypeRow): Listed => ({
  value: typeValue(ctx, row),
  rule: parseRule(row.rule),
});

/**
 * The types as one viewer sees them: each active type with its rule decided for the viewer
 * (`open`, `locked` or `hidden`) and, for a locked one, the hint. The viewer's facts are loaded
 * once for all the rules (one query per kind of fact the rules read, none for a guest or when no
 * type has a rule); the rest is in memory. The rule itself is shown to administrators only.
 */
function forViewer(ctx: Ctx, actor: Actor, types: readonly Listed[], asked?: Language) {
  const ruled = types.filter((type) => type.value.isActive && type.rule.conditions.length > 0);
  const facts =
    ruled.length > 0
      ? actorFacts(
          ctx,
          actor,
          ruled.map((type) => type.rule),
        )
      : null;
  const administrator = can(ctx, actor, "admin.reactionTypes");
  let language = asked;
  return types.map(({ value, rule }) => {
    const ruledHere = value.isActive && rule.conditions.length > 0;
    const open = !ruledHere || evaluate(rule, facts!);
    const locked = !open && !value.hideWhenLocked;
    if (locked) language ??= viewerLanguage(ctx, actor);
    return {
      ...value,
      rule: administrator ? rule : null,
      access: open ? ("open" as const) : locked ? ("locked" as const) : ("hidden" as const),
      lockHint: locked ? lockHint(language!, rule) : null,
    };
  });
}
/**
 * The frame fields a type ends up with, checked against the measured picture: both sizes or
 * neither, dividing the picture, and no more frames than it holds. Without a picture there
 * are no frames.
 */
function checkedFrames(
  ctx: Ctx,
  fileId: number | null,
  width: number | null,
  height: number | null,
  count: number,
) {
  if (fileId === null) {
    if (width !== null || height !== null || count !== 1)
      throw new ValidationError("Frames need a picture.");
    return { width: null, height: null, count: 1 };
  }
  if ((width === null) !== (height === null))
    throw new ValidationError("Give both the frame width and the frame height, or neither.");
  if (width === null || height === null) {
    if (count !== 1) throw new ValidationError("More than one frame needs a frame size.");
    return { width: null, height: null, count: 1 };
  }
  const file = fileSize(ctx, fileId);
  if (file.width % width !== 0 || file.height % height !== 0)
    throw new ValidationError(
      `The frame size ${width}x${height} does not divide the picture (${file.width}x${file.height}).`,
    );
  const cells = (file.width / width) * (file.height / height);
  if (count > cells)
    throw new ValidationError(`The picture holds ${cells} frames of that size, not ${count}.`);
  return { width, height, count };
}
function typeRow(ctx: Ctx, id: number) {
  return prepared(ctx, "reactions.type", () =>
    ctx.sqlite.prepare<TypeRow, [number]>(
      `SELECT ${typeColumns} FROM reaction_types WHERE id = ?1`,
    ),
  ).get(id);
}
function existing(ctx: Ctx, contentType: ReactionContentType, contentId: number, userId: number) {
  return prepared(ctx, "reactions.existing", () =>
    ctx.sqlite.prepare<ReactionRow, [string, number, number]>(existingSql),
  ).get(contentType, contentId, userId);
}
function countsRow(ctx: Ctx, contentType: ReactionContentType, contentId: number) {
  const table = tables[contentType];
  const row = prepared(ctx, `reactions.counts.${contentType}`, () =>
    ctx.sqlite.prepare<{ reaction_counts: string }, [number]>(
      `SELECT reaction_counts FROM ${table} WHERE id = ?1`,
    ),
  ).get(contentId);
  if (!row) throw new NotFoundError();
  return row.reaction_counts;
}
function saveCounts(ctx: Ctx, contentType: ReactionContentType, contentId: number, json: string) {
  // A post also keeps the total, which the index of a member's most-reacted post is ordered by.
  if (contentType === "post") {
    prepared(ctx, "reactions.saveCounts.postTotal", () =>
      ctx.sqlite.prepare<unknown, [string, number, number]>(
        "UPDATE posts SET reaction_counts = ?1, reaction_total = ?3 WHERE id = ?2",
      ),
    ).run(json, contentId, reactionSummary(json, undefined).total);
    return;
  }
  const table = tables[contentType];
  prepared(ctx, `reactions.saveCounts.${contentType}`, () =>
    ctx.sqlite.prepare<unknown, [string, number]>(
      `UPDATE ${table} SET reaction_counts = ?1 WHERE id = ?2`,
    ),
  ).run(json, contentId);
}
function adjustCounts(json: string, oldType: number | null, newType: number | null) {
  const counts = parseReactionCounts(json);
  if (oldType !== null) {
    const key = String(oldType);
    const value = (counts[key] ?? 0) - 1;
    if (value > 0) counts[key] = value;
    else delete counts[key];
  }
  if (newType !== null) {
    const key = String(newType);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return JSON.stringify(counts);
}
/**
 * The rule and forum list a type is saved with, as stored. The rule may hold only `cheap`
 * criteria (it is decided on every reaction) and the forums must be forums, not categories.
 */
function checkedAccess(ctx: Ctx, rule: Rule, forumIds: readonly number[]) {
  assertRule(ctx, rule, "cheap");
  // A rule is decided on every reaction and for every picker drawn: only facts that come from the
  // member's row, groups or purchases (at most three statements, whatever the rules), never a
  // measure of their history (one more statement for each).
  const measured = measuredCriteria(rule);
  if (measured.length > 0)
    throw new ValidationError(
      `A reaction rule cannot use ${[...new Set(measured)].join(", ")}: it reads the member's history, which is too much to check on every reaction.`,
    );
  const ids = [...new Set(forumIds)];
  const tree = getNodeTree(ctx);
  if (ids.some((id) => tree.get(id)?.type !== "forum"))
    throw new ValidationError("forumIds must be existing forums.");
  return { rule: JSON.stringify(rule), forumIds: JSON.stringify(ids) };
}
/** The forum the item is in; null for content that is not in a forum. */
function forumOf(ctx: Ctx, contentType: ReactionContentType, contentId: number): number | null {
  if (contentType !== "post") return null;
  return (
    prepared(ctx, "reactions.postForum", () =>
      ctx.sqlite.prepare<{ node_id: number }, [number]>(
        "SELECT t.node_id FROM posts p JOIN threads t ON t.id = p.thread_id WHERE p.id = ?1",
      ),
    ).get(contentId)?.node_id ?? null
  );
}
/**
 * Refuses a reaction type the actor may not give on this item: it is limited to forums the item
 * is not in (content outside forums counts as elsewhere), or its rule does not hold for the
 * actor. Giving a type again, or taking a reaction back, is never refused here.
 */
function requireUsable(
  ctx: Ctx,
  actor: Actor,
  type: TypeRow,
  contentType: ReactionContentType,
  contentId: number,
) {
  const forums = JSON.parse(type.forum_ids) as number[];
  if (forums.length > 0) {
    const forum = forumOf(ctx, contentType, contentId);
    if (forum === null || !forums.includes(forum))
      throw new ForbiddenError("This reaction cannot be given here.");
  }
  const rule = parseRule(type.rule);
  if (rule.conditions.length > 0 && !evaluate(rule, actorFacts(ctx, actor, [rule])))
    throw new ForbiddenError("This reaction is not available to you.");
}
function requireReactPermission(ctx: Ctx, actor: Actor) {
  const user = requireAuthenticated(actor);
  requirePermission(ctx, actor, "reaction.react");
  return user;
}

export const reactionTypesListOp = implement(
  reactionTypesList,
  (ctx, actor, input) => ({
    items: forViewer(
      ctx,
      actor,
      cached(ctx, "reaction_types", () =>
        prepared(ctx, "reactions.types", () =>
          ctx.sqlite.prepare<TypeRow, []>(
            `SELECT ${typeColumns} FROM reaction_types ORDER BY position, id`,
          ),
        )
          .all()
          .map((row) => listed(ctx, row)),
      ),
      input.language,
    ),
  }),
  { public: "Reaction types are visible to everyone." },
);
export const reactionTypesCreateOp = implement(reactionTypesCreate, (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  requirePermission(ctx, actor, "admin.reactionTypes");
  return writeTx(ctx, () => {
    const fileId = input.fileId ?? null;
    if (fileId !== null) attachUploadedFile(ctx, user.userId, fileId, "reaction_image");
    const frames = checkedFrames(
      ctx,
      fileId,
      input.frameWidth ?? null,
      input.frameHeight ?? null,
      input.frameCount,
    );
    const access = checkedAccess(ctx, input.rule, input.forumIds);
    const row = ctx.sqlite
      .prepare<
        TypeRow,
        [
          string,
          string,
          number,
          number,
          number,
          number | null,
          number | null,
          number | null,
          number,
          string,
          string,
          number,
        ]
      >(
        `INSERT INTO reaction_types (title, emoji, score, position, is_active, image_file_id, frame_width, frame_height, frame_count, rule, forum_ids, hide_when_locked) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12) RETURNING ${typeColumns}`,
      )
      .get(
        input.title,
        input.emoji,
        input.score,
        input.position,
        Number(input.isActive),
        fileId,
        frames.width,
        frames.height,
        frames.count,
        access.rule,
        access.forumIds,
        Number(input.hideWhenLocked),
      )!;
    invalidate(ctx, "reaction_types");
    appendModeratorLog(ctx, actor, "reaction_type.create", "reaction_type", row.id);
    return forViewer(ctx, actor, [listed(ctx, row)])[0]!;
  });
});
export const reactionTypesUpdateOp = implement(reactionTypesUpdate, (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  requirePermission(ctx, actor, "admin.reactionTypes");
  return writeTx(ctx, () => {
    const old = typeRow(ctx, input.reactionTypeId);
    if (!old) throw new NotFoundError();
    const fileId = input.fileId === undefined ? old.image_file_id : input.fileId;
    const replaced = fileId !== old.image_file_id;
    if (replaced && fileId !== null) attachUploadedFile(ctx, user.userId, fileId, "reaction_image");
    const width = input.frameWidth === undefined ? old.frame_width : input.frameWidth;
    const height = input.frameHeight === undefined ? old.frame_height : input.frameHeight;
    // Removing the picture takes its frames with it; clearing the frame size goes back to the
    // whole picture as the one frame, unless a count is sent with it.
    const frames =
      input.fileId === null
        ? checkedFrames(ctx, null, null, null, 1)
        : checkedFrames(
            ctx,
            fileId,
            width,
            height,
            input.frameCount ?? (width === null && height === null ? 1 : old.frame_count),
          );
    // What is not being changed is kept as it is: a stored rule that names a group deleted since
    // must not stop a rename or a reorder.
    const access =
      input.rule === undefined && input.forumIds === undefined
        ? { rule: old.rule, forumIds: old.forum_ids }
        : checkedAccess(
            ctx,
            input.rule ?? parseRule(old.rule),
            input.forumIds ?? (JSON.parse(old.forum_ids) as number[]),
          );
    const row = ctx.sqlite
      .prepare<
        TypeRow,
        [
          string,
          string,
          number,
          number,
          number,
          number | null,
          number | null,
          number | null,
          number,
          string,
          string,
          number,
          number,
        ]
      >(
        `UPDATE reaction_types SET title = ?1, emoji = ?2, score = ?3, position = ?4, is_active = ?5, image_file_id = ?6, frame_width = ?7, frame_height = ?8, frame_count = ?9, rule = ?10, forum_ids = ?11, hide_when_locked = ?12 WHERE id = ?13 RETURNING ${typeColumns}`,
      )
      .get(
        input.title ?? old.title,
        input.emoji ?? old.emoji,
        input.score ?? old.score,
        input.position ?? old.position,
        Number(input.isActive ?? !!old.is_active),
        fileId,
        frames.width,
        frames.height,
        frames.count,
        access.rule,
        access.forumIds,
        Number(input.hideWhenLocked ?? !!old.hide_when_locked),
        old.id,
      )!;
    if (replaced && old.image_file_id !== null) releaseFile(ctx, old.image_file_id);
    invalidate(ctx, "reaction_types");
    appendModeratorLog(ctx, actor, "reaction_type.update", "reaction_type", row.id);
    return forViewer(ctx, actor, [listed(ctx, row)])[0]!;
  });
});
export const reactionsSetOp = implement(reactionsSet, (ctx, actor, input) => {
  const user = requireReactPermission(ctx, actor);
  if (
    (input.contentType === "conversation_message" && !can(ctx, actor, "conversation.react")) ||
    ((input.contentType === "profile_post" || input.contentType === "profile_post_comment") &&
      !can(ctx, actor, "profilePost.react"))
  )
    throw new ForbiddenError();
  requireTermsAccepted(ctx, actor);
  return writeTx(ctx, () => {
    const target = reactables[input.contentType](ctx, actor, input.contentId);
    if (!target.isVisible || target.authorId === user.userId) throw new ForbiddenError();
    // Reacting to a post also needs the permission in its forum.
    if (
      input.contentType === "post" &&
      !can(ctx, actor, "forum.react", {
        nodeId: (target as ReturnType<typeof reactablePost>).nodeId,
      })
    )
      throw new ForbiddenError();
    const type = typeRow(ctx, input.reactionTypeId);
    if (!type?.is_active) throw new ValidationError("Reaction type is unavailable.");
    const previous = existing(ctx, input.contentType, input.contentId, user.userId);
    const json = countsRow(ctx, input.contentType, input.contentId);
    if (previous?.reaction_type_id === type.id) return reactionSummary(json, type.id);
    requireUsable(ctx, actor, type, input.contentType, input.contentId);
    // Giving a negative reaction (or turning a kind one into it) spends the daily budget.
    const negative = type.score < 0;
    if (negative && (previous?.score ?? 0) >= 0) requireNegativeReactionRoom(ctx, actor);
    // A kind reaction turned negative is a new reaction: a new row, so that its id and date
    // are the newest (ids grow with time; the standings bisect on them), and it spends the budget.
    const turnedNegative = negative && previous != null && previous.score >= 0;
    if (previous && turnedNegative) {
      prepared(ctx, "reactions.remove", () =>
        ctx.sqlite.prepare<unknown, [number]>("DELETE FROM reactions WHERE id = ?1"),
      ).run(previous.id);
    }
    if (previous && !turnedNegative) {
      prepared(ctx, "reactions.change", () =>
        ctx.sqlite.prepare<unknown, [number, number, number]>(
          "UPDATE reactions SET reaction_type_id = ?1, score = ?2 WHERE id = ?3",
        ),
      ).run(type.id, type.score, previous.id);
    } else {
      prepared(ctx, "reactions.insert", () =>
        ctx.sqlite.prepare<unknown, [string, number, number, number, number, number, number]>(
          "INSERT INTO reactions (content_type, content_id, user_id, content_user_id, reaction_type_id, score, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        ),
      ).run(
        input.contentType,
        input.contentId,
        user.userId,
        target.authorId,
        type.id,
        type.score,
        ctx.now(),
      );
    }
    const updated = adjustCounts(json, previous?.reaction_type_id ?? null, type.id);
    saveCounts(ctx, input.contentType, input.contentId, updated);
    prepared(ctx, "reactions.score", () =>
      ctx.sqlite.prepare<unknown, [number, number]>(
        "UPDATE users SET reaction_score = reaction_score + ?1 WHERE id = ?2",
      ),
    ).run(type.score - (previous?.score ?? 0), target.authorId);
    publishEvent(ctx, {
      type: "reaction.added",
      targetType: input.contentType,
      targetId: input.contentId,
      payload: { userId: user.userId, contentUserId: target.authorId, reactionTypeId: type.id },
    });
    return reactionSummary(updated, type.id);
  });
});
export const reactionsRemoveOp = implement(reactionsRemove, (ctx, actor, input) => {
  const user = requireReactPermission(ctx, actor);
  return writeTx(ctx, () => {
    const target = reactables[input.contentType](ctx, actor, input.contentId);
    if (!target.isVisible || target.authorId === user.userId) throw new ForbiddenError();
    const previous = existing(ctx, input.contentType, input.contentId, user.userId);
    const json = countsRow(ctx, input.contentType, input.contentId);
    if (!previous) return reactionSummary(json, undefined);
    prepared(ctx, "reactions.delete", () =>
      ctx.sqlite.prepare<unknown, [number]>("DELETE FROM reactions WHERE id = ?1"),
    ).run(previous.id);
    const updated = adjustCounts(json, previous.reaction_type_id, null);
    saveCounts(ctx, input.contentType, input.contentId, updated);
    prepared(ctx, "reactions.score", () =>
      ctx.sqlite.prepare<unknown, [number, number]>(
        "UPDATE users SET reaction_score = reaction_score + ?1 WHERE id = ?2",
      ),
    ).run(-previous.score, target.authorId);
    return reactionSummary(updated, undefined);
  });
});
export const reactionsListOp = implement(
  reactionsList,
  (ctx, actor, input) => {
    requirePermission(ctx, actor, "reaction.viewList");
    reactables[input.contentType](ctx, actor, input.contentId);
    requireSiteView(ctx, actor);
    const after = input.cursor
      ? decodeCursor(input.cursor, z.tuple([z.number().int().nonnegative()]))[0]
      : 0;
    const rows = prepared(ctx, "reactions.list", () =>
      ctx.sqlite.prepare<ReactionRow, [string, number, number, number]>(listSql),
    ).all(input.contentType, input.contentId, after, input.limit + 1);
    const page = rows.slice(0, input.limit);
    const user = loadUserSummaries(
      ctx,
      page.map((row) => row.user_id),
    );
    return {
      items: page.map((row) => ({
        user: user(row.user_id),
        reactionTypeId: row.reaction_type_id,
        createdAt: iso(row.created_at),
      })),
      nextCursor: rows.length > input.limit ? encodeCursor([page.at(-1)!.user_id]) : null,
    };
  },
  {
    public:
      "Content visibility is checked by the reactable helper; who reacted needs reaction.viewList.",
  },
);

export const operations = [
  reactionTypesListOp,
  reactionTypesCreateOp,
  reactionTypesUpdateOp,
  reactionsSetOp,
  reactionsRemoveOp,
  reactionsListOp,
];
