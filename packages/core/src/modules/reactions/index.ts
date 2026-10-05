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
import { implement } from "../../operation";
import { decodeCursor, encodeCursor } from "../../pagination";
import { parseReactionCounts, reactionSummary } from "../../shared/reactions";
import { loadUserSummaries } from "../../shared/users";
import { iso } from "../../time";
import { reactableConversationMessage } from "../conversations";
import { reactablePost } from "../forums";
import { getGlobalPermissions, requireAdmin } from "../permissions";
import { reactableProfileComment, reactableProfilePost } from "../profiles";

type TypeRow = {
  id: number;
  title: string;
  emoji: string;
  score: number;
  position: number;
  is_active: number;
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

function typeValue(r: TypeRow) {
  return {
    id: r.id,
    title: r.title,
    emoji: r.emoji,
    score: r.score,
    position: r.position,
    isActive: !!r.is_active,
  };
}
function typeRow(ctx: Ctx, id: number) {
  return prepared(ctx, "reactions.type", () =>
    ctx.sqlite.prepare<TypeRow, [number]>(
      "SELECT id, title, emoji, score, position, is_active FROM reaction_types WHERE id = ?1",
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
function requireReactPermission(ctx: Ctx, actor: Actor) {
  const user = requireAuthenticated(actor);
  if (!getGlobalPermissions(ctx, actor).canReact) throw new ForbiddenError();
  return user;
}

export const reactionTypesListOp = implement(reactionTypesList, (ctx) => ({
  items: cached(ctx, "reaction_types", () =>
    prepared(ctx, "reactions.types", () =>
      ctx.sqlite.prepare<TypeRow, []>(
        "SELECT id, title, emoji, score, position, is_active FROM reaction_types ORDER BY position, id",
      ),
    )
      .all()
      .map(typeValue),
  ),
}));
export const reactionTypesCreateOp = implement(reactionTypesCreate, (ctx, actor, input) => {
  requireAdmin(ctx, actor);
  return writeTx(ctx, () => {
    const row = ctx.sqlite
      .prepare<TypeRow, [string, string, number, number, number]>(
        "INSERT INTO reaction_types (title, emoji, score, position, is_active) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id, title, emoji, score, position, is_active",
      )
      .get(input.title, input.emoji, input.score, input.position, Number(input.isActive))!;
    invalidate(ctx, "reaction_types");
    return typeValue(row);
  });
});
export const reactionTypesUpdateOp = implement(reactionTypesUpdate, (ctx, actor, input) => {
  requireAdmin(ctx, actor);
  return writeTx(ctx, () => {
    const old = typeRow(ctx, input.reactionTypeId);
    if (!old) throw new NotFoundError();
    const row = ctx.sqlite
      .prepare<TypeRow, [string, string, number, number, number, number]>(
        "UPDATE reaction_types SET title = ?1, emoji = ?2, score = ?3, position = ?4, is_active = ?5 WHERE id = ?6 RETURNING id, title, emoji, score, position, is_active",
      )
      .get(
        input.title ?? old.title,
        input.emoji ?? old.emoji,
        input.score ?? old.score,
        input.position ?? old.position,
        Number(input.isActive ?? !!old.is_active),
        old.id,
      )!;
    invalidate(ctx, "reaction_types");
    return typeValue(row);
  });
});
export const reactionsSetOp = implement(reactionsSet, (ctx, actor, input) => {
  const user = requireReactPermission(ctx, actor);
  return writeTx(ctx, () => {
    const target = reactables[input.contentType](ctx, actor, input.contentId);
    if (!target.isVisible || target.authorId === user.userId) throw new ForbiddenError();
    const type = typeRow(ctx, input.reactionTypeId);
    if (!type?.is_active) throw new ValidationError("Reaction type is unavailable.");
    const previous = existing(ctx, input.contentType, input.contentId, user.userId);
    const json = countsRow(ctx, input.contentType, input.contentId);
    if (previous?.reaction_type_id === type.id) return reactionSummary(json, type.id);
    if (previous) {
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
export const reactionsListOp = implement(reactionsList, (ctx, actor, input) => {
  reactables[input.contentType](ctx, actor, input.contentId);
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
});

export const operations = [
  reactionTypesListOp,
  reactionTypesCreateOp,
  reactionTypesUpdateOp,
  reactionsSetOp,
  reactionsRemoveOp,
  reactionsListOp,
];
