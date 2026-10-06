import type { SQLQueryBindings } from "bun:sqlite";
import * as z from "zod";
import type { Actor } from "../../actor";
import { actorUserId, requireAuthenticated } from "../../actor";
import { type Ctx, invalidate, prepared } from "../../context";
import * as contracts from "../../contracts/forums";
import { writeTx } from "../../db/tx";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { publishEvent } from "../../events";
import { implement, markPublic } from "../../operation";
import { decodeCursor, encodeCursor } from "../../pagination";
import {
  can,
  currentVersions,
  getNodeTree,
  PERMISSIONS,
  PRINCIPAL_COLUMNS,
  permissionsOf,
  permissionValue,
  principalFromRow,
  requirePermission,
  resolvedPermissions,
  viewableNodeIds,
} from "../../permissions";
import { renderContent, storeContentReferences } from "../../render";
import { loadViewerReactions, reactionSummary } from "../../shared/reactions";
import { loadUserSummaries } from "../../shared/users";
import { iso, isoOrNull } from "../../time";
import { loadAttachments, setAttachments, validateEmbeddedAttachments } from "../attachments";
import { completeRunningJob, enqueueJob, registerJobHandler } from "../jobs";
import {
  appendModeratorLog,
  moderateEditedContent,
  prepareModeratedContent,
  recordPostRevision,
  withSpamCheck,
} from "../moderation";
import { seoForNode, seoForThread } from "../seo";
import { excerptFromMarkdown } from "../seo/excerpt";
import { resolvedFileUrl } from "../storage/url";

type State = "visible" | "moderated" | "deleted";
type ThreadRow = {
  id: number;
  node_id: number;
  user_id: number;
  title: string;
  state: State;
  is_sticky: number;
  is_locked: number;
  created_at: number;
  reply_count: number;
  view_count: number;
  first_post_id: number;
  last_post_at: number;
  last_post_id: number;
  last_poster_id: number;
  merged_into_id: number | null;
  thread_banned?: number;
  transfer_role?: string | null;
  transfer_failed_at?: number | null;
};
type PostRow = {
  id: number;
  thread_id: number;
  user_id: number;
  position: number;
  state: State;
  created_at: number;
  edited_at: number | null;
  reaction_counts: string;
  attachment_count: number;
  body_html?: string;
  body_source?: string;
};
type NodeRow = {
  id: number;
  require_thread_approval: number;
  require_reply_approval: number;
  is_read_only: number;
  min_account_age_days: number;
  min_post_count: number;
  icon_file_id: number | null;
  cover_file_id: number | null;
  thread_count: number;
  post_count: number;
  last_post_at: number | null;
  last_post_id: number | null;
  last_thread_id: number | null;
  last_thread_title: string | null;
  last_poster_id: number | null;
};
type ReadRow = { thread_id: number; last_read_post_id: number; last_read_position: number };
function moderationPayload(
  actor: Actor,
  ownerId: number,
  notice: { reason: string; notify: boolean; message?: string },
) {
  return actorUserId(actor) === ownerId
    ? {}
    : {
        actorId: actorUserId(actor),
        reason: notice.reason,
        notify: notice.notify,
        message: notice.message,
      };
}
const threadColumns =
  "id, node_id, user_id, title, state, is_sticky, is_locked, created_at, reply_count, view_count, first_post_id, last_post_at, last_post_id, last_poster_id, merged_into_id";
const threadDetailColumns = threadColumns
  .split(", ")
  .map((column) => `t.${column}`)
  .join(", ");
const postColumns =
  "p.id, p.thread_id, p.user_id, p.position, p.state, p.created_at, p.edited_at, p.reaction_counts, p.attachment_count";
const nodeColumns =
  "id, icon_file_id, cover_file_id, thread_count, post_count, last_post_at, last_post_id, last_thread_id, last_thread_title, last_poster_id, require_thread_approval, require_reply_approval, is_read_only, min_account_age_days, min_post_count";
/** SQL shared by the hot paths and their query-plan tests. */
export const forumSql = {
  sticky: `SELECT ${threadColumns} FROM threads WHERE node_id = ?1 AND is_sticky = 1 AND merged_into_id IS NULL AND (state = 'visible' OR (state = 'moderated' AND (?2 = 1 OR user_id = ?4)) OR (state = 'deleted' AND ?3 = 1)) ORDER BY last_post_at DESC, id DESC`,
  threadPage: `SELECT ${threadColumns} FROM threads WHERE node_id = ?1 AND is_sticky = 0 AND merged_into_id IS NULL AND (state = 'visible' OR (state = 'moderated' AND (?2 = 1 OR user_id = ?7)) OR (state = 'deleted' AND ?3 = 1)) AND (last_post_at, id) < (?4, ?5) ORDER BY last_post_at DESC, id DESC LIMIT ?6`,
  postPage: `SELECT ${postColumns}, b.body_html FROM posts p JOIN post_bodies b ON b.post_id = p.id WHERE p.thread_id = ?1 AND p.position BETWEEN ?2 AND ?3 AND (p.state = 'visible' OR (p.state = 'moderated' AND (?4 = 1 OR p.user_id = ?6)) OR (p.state = 'deleted' AND ?5 = 1)) ORDER BY p.position`,
  postBeyond:
    "SELECT id FROM posts WHERE thread_id = ?1 AND position > ?2 AND (state = 'visible' OR (state = 'moderated' AND (?3 = 1 OR user_id = ?5)) OR (state = 'deleted' AND ?4 = 1)) ORDER BY position LIMIT 1",
  threadDetail: `SELECT ${threadDetailColumns}, x.role AS transfer_role, x.failed_at AS transfer_failed_at, EXISTS(SELECT 1 FROM thread_bans WHERE thread_id = t.id AND user_id = ?2 AND (expires_at IS NULL OR expires_at > ?3)) AS thread_banned FROM threads t LEFT JOIN thread_transfers x ON x.thread_id = t.id WHERE t.id = ?1`,
  maxPostPosition: "SELECT position FROM posts WHERE thread_id = ?1 ORDER BY position DESC LIMIT 1",
  lastPostPositions: "SELECT id, position FROM posts WHERE id IN (SELECT value FROM json_each(?1))",
  readBatch:
    "SELECT thread_id, last_read_post_id, last_read_position FROM thread_reads WHERE user_id = ?1 AND thread_id IN (SELECT value FROM json_each(?2))",
  nodeLast:
    "SELECT id, title, last_post_at, last_post_id, last_poster_id FROM threads WHERE node_id = ?1 AND is_sticky = ?2 AND state = 'visible' ORDER BY last_post_at DESC, id DESC LIMIT 1",
  threadLast:
    "SELECT id, user_id, created_at FROM posts WHERE thread_id = ?1 AND state = 'visible' ORDER BY position DESC, id DESC LIMIT 1",
  authorAdjustment:
    "UPDATE users SET post_count = post_count + ?1 * authors.n FROM (SELECT user_id, count(*) AS n FROM posts WHERE thread_id = ?2 AND state = 'visible' GROUP BY user_id) AS authors WHERE users.id = authors.user_id",
  readPost:
    "SELECT id, position FROM posts WHERE thread_id = ?1 AND position <= ?2 AND state = 'visible' ORDER BY position DESC LIMIT 1",
  readPosition: "SELECT last_read_position FROM thread_reads WHERE user_id = ?1 AND thread_id = ?2",
} as const;
function statement<Row, Params extends SQLQueryBindings[]>(ctx: Ctx, name: string, sql: string) {
  return prepared(ctx, `forums.${name}`, () => ctx.sqlite.prepare<Row, Params>(sql));
}
function forumDb(ctx: Ctx) {
  return prepared(ctx, "forums.statementAccessor", () => ({
    prepare<Row, Params extends SQLQueryBindings[]>(sql: string) {
      return prepared(ctx, `forums.${sql}`, () => ctx.sqlite.prepare<Row, Params>(sql));
    },
  }));
}
const postCursor = z.tuple([z.number().int().nonnegative()]);
const threadCursor = z.tuple([z.number().int(), z.number().int().positive()]);

function threadRow(ctx: Ctx, id: number, viewerId = 0): ThreadRow | undefined {
  return (
    statement<ThreadRow, [number, number, number]>(ctx, "threadDetail", forumSql.threadDetail).get(
      id,
      viewerId,
      ctx.now(),
    ) ?? undefined
  );
}
function checkNodePostingRules(ctx: Ctx, actor: Actor, nodeId: number): NodeRow {
  const settings = nodeRows(ctx, nodeId).get(nodeId);
  if (!settings) throw new NotFoundError();
  if (can(ctx, actor, "forum.bypassNodeRules", { nodeId })) return settings;
  if (settings.is_read_only) throw new ForbiddenError("This forum is read-only.");
  const member = requireAuthenticated(actor);
  const principal =
    member.principal ??
    (() => {
      const row = ctx.sqlite
        .prepare(`SELECT ${PRINCIPAL_COLUMNS} FROM users u WHERE u.id = ?1`)
        .get(member.userId);
      return row
        ? principalFromRow(row as Parameters<typeof principalFromRow>[0], currentVersions(ctx))
        : null;
    })();
  if (
    settings.min_account_age_days &&
    (!principal || ctx.now() - principal.createdAt < settings.min_account_age_days * 86_400_000)
  )
    throw new ForbiddenError("Your account is too new to post in this forum.");
  if (settings.min_post_count && (!principal || principal.postCount < settings.min_post_count))
    throw new ForbiddenError("You need more posts before posting in this forum.");
  return settings;
}
const REORGANIZING = "This thread is being reorganized; try again shortly";
function markTransfer(
  ctx: Ctx,
  threadId: number,
  role: "merge_target" | "merge_source" | "split_source" | "split_target",
  otherThreadId: number,
  jobKey: string,
): void {
  forumDb(ctx)
    .prepare(
      "INSERT INTO thread_transfers (thread_id, role, other_thread_id, job_key, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    )
    .run(threadId, role, otherThreadId, jobKey, ctx.now());
}
function finishTransfer(ctx: Ctx, jobKey: string): void {
  forumDb(ctx).prepare("DELETE FROM thread_transfers WHERE job_key = ?1").run(jobKey);
}
export function assertThreadTransferIdle(ctx: Ctx, ...threadIds: number[]): void {
  if (threadIds.some((id) => threadRow(ctx, id)?.transfer_role))
    throw new ConflictError(REORGANIZING);
}
const assertTransferIdle = assertThreadTransferIdle;
function postRow(ctx: Ctx, id: number, withBody = false): PostRow | undefined {
  return (
    statement<PostRow, [number]>(
      ctx,
      withBody ? "postDetail" : "post",
      withBody
        ? `SELECT ${postColumns}, b.body_html, b.body_source FROM posts p JOIN post_bodies b ON b.post_id = p.id WHERE p.id = ?1`
        : `SELECT ${postColumns} FROM posts p WHERE p.id = ?1`,
    ).get(id) ?? undefined
  );
}
function visible(ctx: Ctx, state: State, owner: number, actor: Actor, nodeId: number): boolean {
  if (state === "visible") return true;
  if (state === "moderated")
    return owner === actorUserId(actor) || can(ctx, actor, "forum.viewModerated", { nodeId });
  return can(ctx, actor, "forum.viewDeleted", { nodeId });
}
function requireNode(ctx: Ctx, actor: Actor, id: number) {
  const node = getNodeTree(ctx).get(id);
  if (!node) throw new NotFoundError();
  requirePermission(ctx, actor, "node.view", { nodeId: id }, { notFound: true });
  return { node };
}
function requireThread(ctx: Ctx, actor: Actor, id: number) {
  const row = threadRow(ctx, id, actorUserId(actor) ?? 0);
  if (!row || row.merged_into_id != null) throw new NotFoundError();
  const { node } = requireNode(ctx, actor, row.node_id);
  if (!visible(ctx, row.state, row.user_id, actor, row.node_id)) throw new NotFoundError();
  return { row, node };
}
function requirePost(ctx: Ctx, actor: Actor, id: number, withBody = false) {
  const post = postRow(ctx, id, withBody);
  if (!post) throw new NotFoundError();
  const thread = requireThread(ctx, actor, post.thread_id);
  if (!visible(ctx, post.state, post.user_id, actor, thread.row.node_id)) throw new NotFoundError();
  return { post, thread };
}
function mayEdit(
  permissions: ReturnType<typeof permissionsOf>,
  nodeId: number,
  post: PostRow,
  locked: number,
): boolean {
  return (
    permissions.can("forum.editAny", { nodeId }) ||
    (!locked &&
      permissions.can("forum.editOwn", {
        nodeId,
        ownerId: post.user_id,
        createdAt: post.created_at,
      }))
  );
}
function mayEditTitle(ctx: Ctx, actor: Actor, row: ThreadRow): boolean {
  return (
    can(ctx, actor, "forum.editAny", { nodeId: row.node_id }) ||
    (!row.is_locked &&
      can(ctx, actor, "forum.editOwnThreadTitle", { nodeId: row.node_id, ownerId: row.user_id }))
  );
}
function mayDelete(
  permissions: ReturnType<typeof permissionsOf>,
  nodeId: number,
  ownerId: number,
  locked: number,
): boolean {
  return (
    permissions.can("forum.deleteAny", { nodeId }) ||
    (!locked && permissions.can("forum.deleteOwn", { nodeId, ownerId }))
  );
}
function canModerate(ctx: Ctx, actor: Actor, nodeId: number): boolean {
  return (
    can(ctx, actor, "forum.deleteAny", { nodeId }) || can(ctx, actor, "forum.approve", { nodeId })
  );
}
function readRows(ctx: Ctx, actor: Actor, ids: number[]): Map<number, ReadRow> {
  const result = new Map<number, ReadRow>();
  const userId = actorUserId(actor);
  if (userId == null || ids.length === 0) return result;
  const rows = statement<ReadRow, [number, string]>(ctx, "readBatch", forumSql.readBatch).all(
    userId,
    JSON.stringify(ids),
  );
  for (const row of rows) result.set(row.thread_id, row);
  return result;
}
function threadValues(ctx: Ctx, actor: Actor, rows: ThreadRow[]) {
  const positions = new Map(
    rows.length === 0
      ? []
      : statement<{ id: number; position: number }, [string]>(
          ctx,
          "lastPostPositions",
          forumSql.lastPostPositions,
        )
          .all(JSON.stringify(rows.map((r) => r.last_post_id)))
          .map((r) => [r.id, r.position] as const),
  );
  const users = loadUserSummaries(
    ctx,
    rows.flatMap((r) => [r.user_id, r.last_poster_id]),
  );
  const reads = readRows(
    ctx,
    actor,
    rows.map((r) => r.id),
  );
  const cutoff = ctx.now() - 30 * 86400000;
  return rows.map((row) => {
    const read = reads.get(row.id);
    return {
      id: row.id,
      nodeId: row.node_id,
      title: row.title,
      author: users(row.user_id),
      state: row.state,
      isSticky: !!row.is_sticky,
      isLocked: !!row.is_locked,
      createdAt: iso(row.created_at),
      replyCount: row.reply_count,
      viewCount: row.view_count + (ctx.views.get(row.id) ?? 0),
      firstPostId: row.first_post_id,
      lastPost: {
        postId: row.last_post_id,
        position: positions.get(row.last_post_id)!,
        postedAt: iso(row.last_post_at),
        user: users(row.last_poster_id),
      },
      readPosition: read?.last_read_position ?? null,
      isUnread:
        actorUserId(actor) != null &&
        row.last_post_at > cutoff &&
        row.last_post_id > (read?.last_read_post_id ?? 0),
    };
  });
}
function postValues(
  ctx: Ctx,
  actor: Actor,
  rows: PostRow[],
  locked: number,
  nodeId: number,
  firstPostId: number,
  detail = false,
) {
  const users = loadUserSummaries(
    ctx,
    rows.map((r) => r.user_id),
  );
  const reactions = loadViewerReactions(
    ctx,
    actor,
    "post",
    rows.map((r) => r.id),
  );
  const permissions = permissionsOf(ctx, actor);
  const attachments = permissions.can("forum.viewAttachments", { nodeId })
    ? loadAttachments(
        ctx,
        "post",
        rows.map((r) => r.id),
      )
    : new Map();
  return rows.map((row) => ({
    id: row.id,
    threadId: row.thread_id,
    position: row.position,
    author: users(row.user_id),
    state: row.state,
    createdAt: iso(row.created_at),
    editedAt: isoOrNull(row.edited_at),
    bodyHtml: row.body_html!,
    attachmentCount: row.attachment_count,
    attachments: attachments.get(row.id) ?? [],
    reactions: reactionSummary(row.reaction_counts, reactions.get(row.id)),
    canEdit: mayEdit(permissions, nodeId, row, locked),
    canDelete:
      row.id !== firstPostId &&
      row.state !== "deleted" &&
      mayDelete(permissions, nodeId, row.user_id, locked),
    ...(detail ? { bodySource: row.body_source } : {}),
  }));
}
function nodeRows(ctx: Ctx, id?: number): Map<number, NodeRow> {
  return new Map(
    (id === undefined
      ? statement<NodeRow, []>(ctx, "allNodeRows", `SELECT ${nodeColumns} FROM nodes`).all()
      : statement<NodeRow, [number]>(
          ctx,
          "oneNodeRow",
          `SELECT ${nodeColumns} FROM nodes WHERE id = ?1`,
        ).all(id)
    ).map((r) => [r.id, r]),
  );
}
function nodeValues(ctx: Ctx, actor: Actor, ids: number[]) {
  const tree = getNodeTree(ctx);
  const rows = nodeRows(ctx, ids.length === 1 ? ids[0] : undefined);
  const users = loadUserSummaries(
    ctx,
    [...rows.values()].flatMap((r) => (r.last_poster_id == null ? [] : [r.last_poster_id])),
  );
  const permissions = permissionsOf(ctx, actor);
  return ids.map((id) => {
    const entry = tree.get(id)!;
    const row = rows.get(id)!;
    const lastPost =
      row.last_post_id == null
        ? null
        : {
            postId: row.last_post_id,
            threadId: row.last_thread_id!,
            threadTitle: row.last_thread_title!,
            postedAt: iso(row.last_post_at!),
            user: users(row.last_poster_id!),
          };
    return {
      ...entry,
      icon:
        row.icon_file_id === null
          ? null
          : { fileId: row.icon_file_id, url: resolvedFileUrl(ctx, row.icon_file_id, true) },
      cover:
        row.cover_file_id === null
          ? null
          : { fileId: row.cover_file_id, url: resolvedFileUrl(ctx, row.cover_file_id, true) },
      threadCount: row.thread_count,
      postCount: row.post_count,
      lastPost,
      permissions: {
        canPost: permissions.can("forum.createThread", { nodeId: id }) && entry.type === "forum",
        canModerate:
          permissions.can("forum.deleteAny", { nodeId: id }) ||
          permissions.can("forum.approve", { nodeId: id }),
      },
      settings: {
        requireThreadApproval: !!row.require_thread_approval,
        requireReplyApproval: !!row.require_reply_approval,
        isReadOnly: !!row.is_read_only,
        minAccountAgeDays: row.min_account_age_days,
        minPostCount: row.min_post_count,
      },
    };
  });
}
function threadValue(ctx: Ctx, actor: Actor, id: number) {
  return threadValues(ctx, actor, [threadRow(ctx, id)!])[0]!;
}
function postValue(ctx: Ctx, actor: Actor, id: number, detail = false) {
  const post = postRow(ctx, id, true)!;
  const thread = threadRow(ctx, post.thread_id)!;
  return postValues(
    ctx,
    actor,
    [post],
    thread.is_locked,
    thread.node_id,
    thread.first_post_id,
    detail,
  )[0]!;
}

export const nodesListOp = implement(contracts.nodesList, (ctx, actor) => {
  return {
    items: nodeValues(ctx, actor, viewableNodeIds(ctx, actor)),
  };
});
export const nodesGetOp = implement(contracts.nodesGet, (ctx, actor, input) => {
  requireNode(ctx, actor, input.nodeId);
  return {
    node: nodeValues(ctx, actor, [input.nodeId])[0]!,
    seo: seoForNode(ctx, actor, input.nodeId),
    breadcrumbs: getNodeTree(ctx)
      .ancestors(input.nodeId)
      .map(({ id, title, type }) => ({ id, title, type })),
    resolvedPermissions: resolvedPermissions(ctx, actor, { nodeId: input.nodeId }),
  };
});
/** Applies the given node settings (inside the node write's transaction). */
function writeNodeSettings(
  ctx: Ctx,
  nodeId: number,
  settings:
    | z.infer<typeof contracts.NodeSettings>
    | Partial<z.infer<typeof contracts.NodeSettings>>
    | undefined,
): void {
  if (!settings) return;
  const columns: [keyof z.infer<typeof contracts.NodeSettings>, string][] = [
    ["requireThreadApproval", "require_thread_approval"],
    ["requireReplyApproval", "require_reply_approval"],
    ["isReadOnly", "is_read_only"],
    ["minAccountAgeDays", "min_account_age_days"],
    ["minPostCount", "min_post_count"],
  ];
  for (const [key, column] of columns) {
    const value = settings[key];
    if (value === undefined) continue;
    forumDb(ctx)
      .prepare(`UPDATE nodes SET ${column} = ?1 WHERE id = ?2`)
      .run(typeof value === "boolean" ? Number(value) : value, nodeId);
  }
}
export const nodesCreateOp = implement(contracts.nodesCreate, (ctx, actor, input) => {
  requireAuthenticated(actor);
  requirePermission(ctx, actor, "admin.nodes");
  const id = writeTx(ctx, () => {
    if (input.parentId != null && !getNodeTree(ctx).get(input.parentId)) throw new NotFoundError();
    const row = forumDb(ctx)
      .prepare<{ id: number }, [number | null, string, string, string, number, number]>(
        "INSERT INTO nodes (parent_id, type, title, description, position, content_updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id",
      )
      .get(input.parentId, input.type, input.title, input.description, input.position, ctx.now())!;
    writeNodeSettings(ctx, row.id, input.settings);
    invalidate(ctx, "node_tree");
    publishEvent(ctx, { type: "content.created", targetType: "node", targetId: row.id });
    appendModeratorLog(ctx, actor, "node.create", "node", row.id, "", {}, row.id);
    return row.id;
  });
  return nodeValues(ctx, actor, [id])[0]!;
});
export const nodesUpdateOp = implement(contracts.nodesUpdate, (ctx, actor, input) => {
  requireAuthenticated(actor);
  requirePermission(ctx, actor, "admin.nodes");
  writeTx(ctx, () => {
    const tree = getNodeTree(ctx);
    const current = tree.get(input.nodeId);
    if (!current || (input.parentId != null && !tree.get(input.parentId)))
      throw new NotFoundError();
    if (input.parentId != null && tree.subtreeIds(input.nodeId).includes(input.parentId))
      throw new ValidationError("A node cannot be its own descendant.");
    forumDb(ctx)
      .prepare(
        "UPDATE nodes SET parent_id = ?1, title = ?2, description = ?3, position = ?4, content_updated_at = ?6 WHERE id = ?5",
      )
      .run(
        input.parentId === undefined ? current.parentId : input.parentId,
        input.title ?? current.title,
        input.description ?? current.description,
        input.position ?? current.position,
        input.nodeId,
        ctx.now(),
      );
    writeNodeSettings(ctx, input.nodeId, input.settings);
    invalidate(ctx, "node_tree");
    publishEvent(ctx, { type: "content.edited", targetType: "node", targetId: input.nodeId });
    appendModeratorLog(ctx, actor, "node.update", "node", input.nodeId, "", {}, input.nodeId);
  });
  return nodeValues(ctx, actor, [input.nodeId])[0]!;
});

export const nodesSetModeratorOp = implement(contracts.nodesSetModerator, (ctx, actor, input) => {
  requireAuthenticated(actor);
  requirePermission(ctx, actor, "admin.permissions");
  return writeTx(ctx, () => {
    if (!getNodeTree(ctx).get(input.nodeId)) throw new NotFoundError();
    if (
      !forumDb(ctx)
        .prepare<{ id: number }, [number]>("SELECT id FROM users WHERE id = ?1")
        .get(input.userId)
    )
      throw new NotFoundError();
    const ids = Object.entries(PERMISSIONS)
      .filter(
        ([id, def]) =>
          def.scope === "node" &&
          (("legacy" in def && def.legacy === PERMISSIONS["forum.viewModerated"].legacy) ||
            id === "forum.viewLog" ||
            id === "forum.bypassNodeRules"),
      )
      .map(([id]) => id);
    const values = JSON.stringify(ids);
    if (input.remove) {
      forumDb(ctx)
        .prepare(
          "DELETE FROM permission_entries WHERE node_id = ?1 AND user_id = ?2 AND group_id = 0 AND value = 1 AND permission_id IN (SELECT id FROM permission_definitions WHERE key IN (SELECT value FROM json_each(?3)))",
        )
        .run(input.nodeId, input.userId, values);
    } else {
      forumDb(ctx)
        .prepare(
          "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) SELECT id, ?1, 0, ?2, 1 FROM permission_definitions WHERE key IN (SELECT value FROM json_each(?3)) ON CONFLICT (group_id, user_id, node_id, permission_id) DO NOTHING",
        )
        .run(input.nodeId, input.userId, values);
    }
    appendModeratorLog(
      ctx,
      actor,
      input.remove ? "node.moderator.remove" : "node.moderator.add",
      "node",
      input.nodeId,
      "",
      { userId: input.userId },
      input.nodeId,
    );
    return { ok: true as const };
  });
});

export const threadsListOp = implement(contracts.threadsList, (ctx, actor, input) => {
  const { node } = requireNode(ctx, actor, input.nodeId);
  if (node.type !== "forum") throw new ValidationError("Threads can only be listed in forums.");
  const userId = actorUserId(actor) ?? -1;
  const permissions = permissionsOf(ctx, actor);
  const viewModerated = Number(permissions.can("forum.viewModerated", { nodeId: input.nodeId }));
  const viewDeleted = Number(permissions.can("forum.viewDeleted", { nodeId: input.nodeId }));
  const cursor = input.cursor ? decodeCursor(input.cursor, threadCursor) : null;
  const sticky = cursor
    ? []
    : statement<ThreadRow, [number, number, number, number]>(ctx, "sticky", forumSql.sticky).all(
        input.nodeId,
        viewModerated,
        viewDeleted,
        userId,
      );
  const rows = statement<ThreadRow, [number, number, number, number, number, number, number]>(
    ctx,
    "threadPage",
    forumSql.threadPage,
  ).all(
    input.nodeId,
    viewModerated,
    viewDeleted,
    cursor?.[0] ?? Number.MAX_SAFE_INTEGER,
    cursor?.[1] ?? Number.MAX_SAFE_INTEGER,
    input.limit + 1,
    userId,
  );
  const page = rows.slice(0, input.limit);
  const values = threadValues(ctx, actor, [...sticky, ...page]);
  const nextCursor =
    rows.length > input.limit ? encodeCursor([page.at(-1)!.last_post_at, page.at(-1)!.id]) : null;
  return { sticky: values.slice(0, sticky.length), items: values.slice(sticky.length), nextCursor };
});
export const threadsGetOp = implement(contracts.threadsGet, (ctx, actor, input) => {
  let targetId = input.threadId;
  const mergedTarget = statement<{ merged_into_id: number | null }, [number]>(
    ctx,
    "mergedTarget",
    "SELECT merged_into_id FROM threads WHERE id = ?1",
  );
  for (let hops = 0; hops < 16; hops++) {
    const next = mergedTarget.get(targetId)?.merged_into_id;
    if (!next) break;
    targetId = next;
  }
  const { row, node } = requireThread(ctx, actor, targetId);
  ctx.views.set(row.id, (ctx.views.get(row.id) ?? 0) + 1);
  return {
    thread: threadValue(ctx, actor, row.id),
    seo: { ...seoForThread(ctx, actor, row.id), redirect: targetId !== input.threadId },
    node: { id: node.id, title: node.title },
    permissions: {
      canReply:
        can(ctx, actor, "forum.reply", {
          nodeId: node.id,
          threadBanned: !!row.thread_banned,
        }) &&
        (!row.is_locked || can(ctx, actor, "forum.replyLocked", { nodeId: node.id })),
      canEditTitle: mayEditTitle(ctx, actor, row),
      canModerate: canModerate(ctx, actor, node.id),
    },
    resolvedPermissions: resolvedPermissions(ctx, actor, { nodeId: node.id }),
  };
});

export const postsListOp = implement(contracts.postsList, (ctx, actor, input) => {
  const { row } = requireThread(ctx, actor, input.threadId);
  const permissions = permissionsOf(ctx, actor);
  const viewModerated = Number(permissions.can("forum.viewModerated", { nodeId: row.node_id }));
  const viewDeleted = Number(permissions.can("forum.viewDeleted", { nodeId: row.node_id }));
  const cursor = input.cursor ? decodeCursor(input.cursor, postCursor) : null;
  const start = cursor?.[0] ?? ((input.page ?? 1) - 1) * input.limit;
  const end = start + input.limit - 1;
  const rows = statement<PostRow, [number, number, number, number, number, number]>(
    ctx,
    "postPage",
    forumSql.postPage,
  ).all(input.threadId, start, end, viewModerated, viewDeleted, actorUserId(actor) ?? -1);
  const beyond = statement<{ id: number }, [number, number, number, number, number]>(
    ctx,
    "postBeyond",
    forumSql.postBeyond,
  ).get(input.threadId, end, viewModerated, viewDeleted, actorUserId(actor) ?? -1);
  return {
    items: postValues(ctx, actor, rows, row.is_locked, row.node_id, row.first_post_id),
    nextCursor: beyond ? encodeCursor([end + 1]) : null,
  };
});
export const postsGetOp = implement(contracts.postsGet, (ctx, actor, input) => {
  const { post, thread } = requirePost(ctx, actor, input.postId, true);
  return postValues(
    ctx,
    actor,
    [post],
    thread.row.is_locked,
    thread.row.node_id,
    thread.row.first_post_id,
    true,
  )[0]! as z.infer<typeof contracts.PostDetail>;
});

/** For reactions: returns a visible post's author and reaction eligibility. */
export const reactablePost = markPublic(
  "Visibility is checked here; callers decide reaction permission.",
  function reactablePost(
    ctx: Ctx,
    actor: Actor,
    postId: number,
  ): { authorId: number; isVisible: boolean } {
    const { post, thread } = requirePost(ctx, actor, postId);
    return {
      authorId: post.user_id,
      isVisible: post.state === "visible" && thread.row.state === "visible",
    };
  },
);

function updateNodeLast(ctx: Ctx, nodeId: number): void {
  const stmt = prepared(ctx, "forums.nodeLast", () =>
    forumDb(ctx).prepare<
      Pick<ThreadRow, "id" | "title" | "last_post_at" | "last_post_id" | "last_poster_id">,
      [number, number]
    >(forumSql.nodeLast),
  );
  const regular = stmt.get(nodeId, 0);
  const sticky = stmt.get(nodeId, 1);
  const best = [regular, sticky]
    .filter((r) => r != null)
    .sort((a, b) => b!.last_post_at - a!.last_post_at || b!.id - a!.id)[0];
  forumDb(ctx)
    .prepare(
      "UPDATE nodes SET last_post_at = ?1, last_post_id = ?2, last_thread_id = ?3, last_thread_title = ?4, last_poster_id = ?5 WHERE id = ?6",
    )
    .run(
      best?.last_post_at ?? null,
      best?.last_post_id ?? null,
      best?.id ?? null,
      best?.title ?? null,
      best?.last_poster_id ?? null,
      nodeId,
    );
}
function updateThreadLast(ctx: Ctx, threadId: number): void {
  const last = prepared(ctx, "forums.threadLast", () =>
    forumDb(ctx).prepare<{ id: number; user_id: number; created_at: number }, [number]>(
      forumSql.threadLast,
    ),
  ).get(threadId);
  if (!last) throw new Error("A thread must have a visible first post.");
  forumDb(ctx)
    .prepare(
      "UPDATE threads SET last_post_at = ?1, last_post_id = ?2, last_poster_id = ?3 WHERE id = ?4",
    )
    .run(last.created_at, last.id, last.user_id, threadId);
}
function markRead(
  ctx: Ctx,
  userId: number,
  threadId: number,
  postId: number,
  position: number,
): number {
  forumDb(ctx)
    .prepare(
      "INSERT INTO thread_reads (user_id, thread_id, last_read_post_id, last_read_position, read_at) VALUES (?1, ?2, ?3, ?4, ?5) " +
        "ON CONFLICT (user_id, thread_id) DO UPDATE SET last_read_post_id = excluded.last_read_post_id, last_read_position = excluded.last_read_position, read_at = excluded.read_at " +
        "WHERE excluded.last_read_post_id > thread_reads.last_read_post_id",
    )
    .run(userId, threadId, postId, position, ctx.now());
  return prepared(ctx, "forums.readPosition", () =>
    forumDb(ctx).prepare<{ last_read_position: number }, [number, number]>(forumSql.readPosition),
  ).get(userId, threadId)!.last_read_position;
}
function adjustThreadAuthors(ctx: Ctx, threadId: number, delta: number): void {
  forumDb(ctx).prepare(forumSql.authorAdjustment).run(delta, threadId);
}
function changeThreadState(ctx: Ctx, id: number, state: State): boolean {
  const row = threadRow(ctx, id)!;
  if (row.state === state) return false;
  const before = row.state === "visible";
  const after = state === "visible";
  forumDb(ctx)
    .prepare("UPDATE threads SET state = ?1, content_updated_at = ?2 WHERE id = ?3")
    .run(state, ctx.now(), row.id);
  if (before !== after) {
    const delta = after ? 1 : -1;
    forumDb(ctx)
      .prepare(
        "UPDATE nodes SET thread_count = thread_count + ?1, post_count = post_count + ?2 WHERE id = ?3",
      )
      .run(delta, delta * (row.reply_count + 1), row.node_id);
    adjustThreadAuthors(ctx, row.id, delta);
    updateNodeLast(ctx, row.node_id);
  }
  return true;
}

export const threadsCreateOp = implement(contracts.threadsCreate, (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  const { node } = requireNode(ctx, actor, input.nodeId);
  requirePermission(ctx, actor, "forum.createThread", { nodeId: input.nodeId });
  if (node.type !== "forum") throw new ValidationError("Categories cannot hold threads.");
  checkNodePostingRules(ctx, actor, input.nodeId);
  if (input.attachmentIds?.length)
    requirePermission(ctx, actor, "forum.uploadAttachments", { nodeId: input.nodeId });
  return withSpamCheck(ctx, actor, input.body, "forum-post", (spam) => {
    const content = prepareModeratedContent(ctx, actor, input.body, true);
    permissionValue(ctx, actor, "mention.maxPerItem");
    const refs = renderContent(ctx, actor, content.source);
    const html = refs.html;
    const ids = writeTx(ctx, () => {
      const decision = prepareModeratedContent(ctx, actor, input.body, true);
      if (decision.source !== content.source)
        throw new ConflictError("Moderation rules changed; retry.");
      const settings = checkNodePostingRules(ctx, actor, input.nodeId);
      const state =
        decision.moderated ||
        spam ||
        (settings.require_thread_approval &&
          !can(ctx, actor, "forum.bypassNodeRules", { nodeId: input.nodeId }))
          ? "moderated"
          : "visible";
      const now = ctx.now();
      const thread = forumDb(ctx)
        .prepare<{ id: number }, [number, number, string, string, number, string]>(
          "INSERT INTO threads (node_id, user_id, title, state, created_at, last_post_at, last_poster_id, content_updated_at, excerpt) VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?2, ?5, ?6) RETURNING id",
        )
        .get(
          input.nodeId,
          user.userId,
          input.title,
          state,
          now,
          excerptFromMarkdown(content.source),
        )!;
      const post = forumDb(ctx)
        .prepare<{ id: number }, [number, number, number]>(
          "INSERT INTO posts (thread_id, user_id, position, created_at) VALUES (?1, ?2, 0, ?3) RETURNING id",
        )
        .get(thread.id, user.userId, now)!;
      forumDb(ctx)
        .prepare("INSERT INTO post_bodies (post_id, body_source, body_html) VALUES (?1, ?2, ?3)")
        .run(post.id, refs.source, html);
      storeContentReferences(ctx, "post", post.id, refs);
      setAttachments(ctx, user.userId, "post", post.id, input.attachmentIds ?? []);
      validateEmbeddedAttachments(ctx, "post", post.id, html);
      forumDb(ctx)
        .prepare("UPDATE threads SET first_post_id = ?1, last_post_id = ?1 WHERE id = ?2")
        .run(post.id, thread.id);
      if (state === "visible") {
        forumDb(ctx)
          .prepare(
            "UPDATE nodes SET thread_count = thread_count + 1, post_count = post_count + 1 WHERE id = ?1",
          )
          .run(input.nodeId);
        updateNodeLast(ctx, input.nodeId);
        forumDb(ctx)
          .prepare("UPDATE users SET post_count = post_count + 1 WHERE id = ?1")
          .run(user.userId);
      }
      markRead(ctx, user.userId, thread.id, post.id, 0);
      publishEvent(ctx, { type: "content.created", targetType: "thread", targetId: thread.id });
      publishEvent(ctx, { type: "content.created", targetType: "post", targetId: post.id });
      return { threadId: thread.id, postId: post.id };
    });
    return {
      thread: threadValue(ctx, actor, ids.threadId),
      post: postValue(ctx, actor, ids.postId, true) as z.infer<typeof contracts.PostDetail>,
    };
  });
});
export const postsCreateOp = implement(contracts.postsCreate, (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  const { row } = requireThread(ctx, actor, input.threadId);
  requirePermission(ctx, actor, "forum.reply", {
    nodeId: row.node_id,
    threadBanned: !!row.thread_banned,
  });
  if (row.is_locked) requirePermission(ctx, actor, "forum.replyLocked", { nodeId: row.node_id });
  checkNodePostingRules(ctx, actor, row.node_id);
  if (input.attachmentIds?.length)
    requirePermission(ctx, actor, "forum.uploadAttachments", { nodeId: row.node_id });
  return withSpamCheck(ctx, actor, input.body, "reply", (spam) => {
    const content = prepareModeratedContent(ctx, actor, input.body, true);
    const refs = renderContent(ctx, actor, content.source);
    const html = refs.html;
    const id = writeTx(ctx, () => {
      const decision = prepareModeratedContent(ctx, actor, input.body, true);
      if (decision.source !== content.source)
        throw new ConflictError("Moderation rules changed; retry.");
      const current = threadRow(ctx, row.id)!;
      if (current.node_id !== row.node_id || current.state !== row.state)
        throw new ConflictError("Thread changed; retry.");
      const settings = checkNodePostingRules(ctx, actor, current.node_id);
      const state =
        decision.moderated ||
        spam ||
        (settings.require_reply_approval &&
          !can(ctx, actor, "forum.bypassNodeRules", { nodeId: row.node_id }))
          ? "moderated"
          : "visible";
      if (current.transfer_role === "merge_target" || current.transfer_role === "split_target")
        throw new ConflictError(REORGANIZING);
      const position =
        (statement<{ position: number }, [number]>(
          ctx,
          "maxPostPosition",
          forumSql.maxPostPosition,
        ).get(row.id)?.position ?? -1) + 1;
      const now = ctx.now();
      const post = forumDb(ctx)
        .prepare<{ id: number }, [number, number, number, string, number]>(
          "INSERT INTO posts (thread_id, user_id, position, state, created_at) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id",
        )
        .get(row.id, user.userId, position, state, now)!;
      forumDb(ctx)
        .prepare("INSERT INTO post_bodies (post_id, body_source, body_html) VALUES (?1, ?2, ?3)")
        .run(post.id, refs.source, html);
      storeContentReferences(ctx, "post", post.id, refs);
      setAttachments(ctx, user.userId, "post", post.id, input.attachmentIds ?? []);
      validateEmbeddedAttachments(ctx, "post", post.id, html);
      if (state === "visible") {
        forumDb(ctx)
          .prepare(
            "UPDATE threads SET reply_count = reply_count + 1, last_post_at = ?1, last_post_id = ?2, last_poster_id = ?3, content_updated_at = ?1 WHERE id = ?4",
          )
          .run(now, post.id, user.userId, row.id);
      }
      if (current.state === "visible" && state === "visible") {
        forumDb(ctx)
          .prepare("UPDATE nodes SET post_count = post_count + 1 WHERE id = ?1")
          .run(current.node_id);
        updateNodeLast(ctx, current.node_id);
        forumDb(ctx)
          .prepare("UPDATE users SET post_count = post_count + 1 WHERE id = ?1")
          .run(user.userId);
      }
      markRead(ctx, user.userId, row.id, post.id, position);
      publishEvent(ctx, { type: "content.created", targetType: "post", targetId: post.id });
      return post.id;
    });
    return postValue(ctx, actor, id, true) as z.infer<typeof contracts.PostDetail>;
  });
});
export const threadsUpdateOp = implement(contracts.threadsUpdate, (ctx, actor, input) => {
  requireAuthenticated(actor);
  const { row } = requireThread(ctx, actor, input.threadId);
  if (!mayEditTitle(ctx, actor, row)) throw new ForbiddenError();
  writeTx(ctx, () => {
    const current = threadRow(ctx, row.id)!;
    forumDb(ctx)
      .prepare("UPDATE threads SET title = ?1, content_updated_at = ?2 WHERE id = ?3")
      .run(input.title, ctx.now(), row.id);
    forumDb(ctx)
      .prepare("UPDATE nodes SET last_thread_title = ?1 WHERE id = ?2 AND last_thread_id = ?3")
      .run(input.title, current.node_id, row.id);
    publishEvent(ctx, {
      type: "content.edited",
      targetType: "thread",
      targetId: row.id,
      payload: moderationPayload(actor, row.user_id, input),
    });
    if (can(ctx, actor, "forum.editAny", { nodeId: row.node_id }))
      appendModeratorLog(
        ctx,
        actor,
        "thread.update",
        "thread",
        row.id,
        input.reason,
        {},
        row.node_id,
      );
  });
  return threadValue(ctx, actor, row.id);
});
export const postsUpdateOp = implement(contracts.postsUpdate, (ctx, actor, input) => {
  requireAuthenticated(actor);
  const { post, thread } = requirePost(ctx, actor, input.postId);
  const permissions = permissionsOf(ctx, actor);
  if (!mayEdit(permissions, thread.row.node_id, post, thread.row.is_locked))
    throw new ForbiddenError();
  const content = prepareModeratedContent(ctx, actor, input.body, false);
  const refs = renderContent(ctx, actor, content.source, {
    edit: { contentType: "post", contentId: post.id, authorId: post.user_id },
  });
  const html = refs.html;
  writeTx(ctx, () => {
    if (input.attachmentIds?.length) {
      const attached = new Set(
        statement<{ file_id: number }, [number]>(
          ctx,
          "postAttachmentIds",
          "SELECT file_id FROM attachments WHERE content_type = 'post' AND content_id = ?1 ORDER BY position",
        )
          .all(post.id)
          .map((row) => row.file_id),
      );
      if (input.attachmentIds.some((id) => !attached.has(id)))
        requirePermission(ctx, actor, "forum.uploadAttachments", { nodeId: thread.row.node_id });
    }
    const decision = prepareModeratedContent(ctx, actor, input.body, false);
    if (decision.source !== content.source)
      throw new ConflictError("Moderation rules changed; retry.");
    recordPostRevision(ctx, actor, post.id);
    setAttachments(ctx, actorUserId(actor)!, "post", post.id, input.attachmentIds);
    validateEmbeddedAttachments(ctx, "post", post.id, html);
    forumDb(ctx)
      .prepare("UPDATE post_bodies SET body_source = ?1, body_html = ?2 WHERE post_id = ?3")
      .run(refs.source, html, post.id);
    storeContentReferences(ctx, "post", post.id, refs);
    if (decision.moderated) moderateEditedContent(ctx, actor, { type: "post", id: post.id });
    forumDb(ctx).prepare("UPDATE posts SET edited_at = ?1 WHERE id = ?2").run(ctx.now(), post.id);
    forumDb(ctx)
      .prepare("UPDATE threads SET content_updated_at = ?1 WHERE id = ?2")
      .run(ctx.now(), post.thread_id);
    if (post.id === thread.row.first_post_id)
      forumDb(ctx)
        .prepare("UPDATE threads SET excerpt = ?1 WHERE id = ?2")
        .run(excerptFromMarkdown(content.source), post.thread_id);
    publishEvent(ctx, {
      type: "content.edited",
      targetType: "post",
      targetId: post.id,
      payload: moderationPayload(actor, post.user_id, input),
    });
    if (
      can(ctx, actor, "forum.editAny", { nodeId: thread.row.node_id }) &&
      post.user_id !== actorUserId(actor)
    )
      appendModeratorLog(
        ctx,
        actor,
        "post.edit",
        "post",
        post.id,
        input.reason,
        {},
        thread.row.node_id,
      );
  });
  return postValue(ctx, actor, post.id, true) as z.infer<typeof contracts.PostDetail>;
});

export const threadsSetStickyOp = implement(contracts.threadsSetSticky, (ctx, actor, input) => {
  requireAuthenticated(actor);
  const { row } = requireThread(ctx, actor, input.threadId);
  requirePermission(ctx, actor, "forum.stick", { nodeId: row.node_id });
  writeTx(ctx, () => {
    forumDb(ctx)
      .prepare("UPDATE threads SET is_sticky = ?1 WHERE id = ?2")
      .run(Number(input.isSticky), row.id);
    publishEvent(ctx, {
      type: "content.edited",
      targetType: "thread",
      targetId: row.id,
      payload: moderationPayload(actor, row.user_id, input),
    });
    appendModeratorLog(
      ctx,
      actor,
      "thread.sticky",
      "thread",
      row.id,
      input.reason,
      {
        isSticky: input.isSticky,
      },
      row.node_id,
    );
  });
  return threadValue(ctx, actor, row.id);
});
export const threadsSetLockedOp = implement(contracts.threadsSetLocked, (ctx, actor, input) => {
  requireAuthenticated(actor);
  const { row } = requireThread(ctx, actor, input.threadId);
  requirePermission(ctx, actor, "forum.lock", { nodeId: row.node_id });
  writeTx(ctx, () => {
    forumDb(ctx)
      .prepare("UPDATE threads SET is_locked = ?1 WHERE id = ?2")
      .run(Number(input.isLocked), row.id);
    publishEvent(ctx, {
      type: "content.edited",
      targetType: "thread",
      targetId: row.id,
      payload: moderationPayload(actor, row.user_id, input),
    });
    appendModeratorLog(
      ctx,
      actor,
      "thread.lock",
      "thread",
      row.id,
      input.reason,
      {
        isLocked: input.isLocked,
      },
      row.node_id,
    );
  });
  return threadValue(ctx, actor, row.id);
});
export const threadsMoveOp = implement(contracts.threadsMove, (ctx, actor, input) => {
  requireAuthenticated(actor);
  assertTransferIdle(ctx, input.threadId);
  const { row } = requireThread(ctx, actor, input.threadId);
  requirePermission(ctx, actor, "forum.move", { nodeId: row.node_id });
  const target = requireNode(ctx, actor, input.nodeId);
  requirePermission(ctx, actor, "forum.move", { nodeId: input.nodeId });
  if (target.node.type !== "forum")
    throw new ValidationError("Threads can only be moved to forums.");
  writeTx(ctx, () => {
    assertTransferIdle(ctx, row.id);
    const current = threadRow(ctx, row.id)!;
    if (current.node_id === input.nodeId) {
      appendModeratorLog(
        ctx,
        actor,
        "thread.move",
        "thread",
        row.id,
        input.reason,
        {
          nodeId: input.nodeId,
          changed: false,
        },
        current.node_id,
      );
      return;
    }
    forumDb(ctx).prepare("UPDATE threads SET node_id = ?1 WHERE id = ?2").run(input.nodeId, row.id);
    forumDb(ctx)
      .prepare(
        "UPDATE report_groups SET node_id = ?1 WHERE target_type = 'post' AND target_id IN (SELECT id FROM posts WHERE thread_id = ?2)",
      )
      .run(input.nodeId, row.id);
    forumDb(ctx)
      .prepare(
        "UPDATE moderator_log SET node_id = ?1 WHERE target_type = 'post' AND target_id IN (SELECT id FROM posts WHERE thread_id = ?2)",
      )
      .run(input.nodeId, row.id);
    forumDb(ctx)
      .prepare(
        "UPDATE moderator_log SET node_id = ?1 WHERE target_type = 'thread' AND target_id = ?2",
      )
      .run(input.nodeId, row.id);
    if (current.state === "visible") {
      forumDb(ctx)
        .prepare(
          "UPDATE nodes SET thread_count = thread_count + ?1, post_count = post_count + ?2 WHERE id = ?3",
        )
        .run(-1, -(current.reply_count + 1), current.node_id);
      forumDb(ctx)
        .prepare(
          "UPDATE nodes SET thread_count = thread_count + ?1, post_count = post_count + ?2 WHERE id = ?3",
        )
        .run(1, current.reply_count + 1, input.nodeId);
      updateNodeLast(ctx, current.node_id);
      updateNodeLast(ctx, input.nodeId);
    }
    publishEvent(ctx, {
      type: "content.edited",
      targetType: "thread",
      targetId: row.id,
      payload: moderationPayload(actor, row.user_id, input),
    });
    appendModeratorLog(
      ctx,
      actor,
      "thread.move",
      "thread",
      row.id,
      input.reason,
      { nodeId: input.nodeId },
      input.nodeId,
    );
  });
  return threadValue(ctx, actor, row.id);
});
export const threadsDeleteOp = implement(contracts.threadsDelete, (ctx, actor, input) => {
  requireAuthenticated(actor);
  assertTransferIdle(ctx, input.threadId);
  const { row } = requireThread(ctx, actor, input.threadId);
  requirePermission(ctx, actor, "forum.deleteAny", { nodeId: row.node_id });
  writeTx(ctx, () => {
    assertTransferIdle(ctx, row.id);
    if (changeThreadState(ctx, row.id, "deleted"))
      publishEvent(ctx, {
        type: "content.deleted",
        targetType: "thread",
        targetId: row.id,
        payload: {
          previousState: row.state,
          state: "deleted",
          ...moderationPayload(actor, row.user_id, input),
        },
      });
    appendModeratorLog(
      ctx,
      actor,
      "thread.delete",
      "thread",
      row.id,
      input.reason,
      {},
      row.node_id,
    );
  });
  return threadValue(ctx, actor, row.id);
});
export const threadsRestoreOp = implement(contracts.threadsRestore, (ctx, actor, input) => {
  requireAuthenticated(actor);
  assertTransferIdle(ctx, input.threadId);
  const { row } = requireThread(ctx, actor, input.threadId);
  if (row.state === "moderated")
    requirePermission(ctx, actor, "forum.approve", { nodeId: row.node_id });
  else if (row.state === "deleted")
    requirePermission(ctx, actor, "forum.undelete", { nodeId: row.node_id });
  else if (
    !can(ctx, actor, "forum.undelete", { nodeId: row.node_id }) &&
    !can(ctx, actor, "forum.approve", { nodeId: row.node_id })
  )
    throw new ForbiddenError();
  writeTx(ctx, () => {
    assertTransferIdle(ctx, row.id);
    if (changeThreadState(ctx, row.id, "visible"))
      publishEvent(ctx, {
        type: "content.state_changed",
        targetType: "thread",
        targetId: row.id,
        payload: {
          previousState: row.state,
          state: "visible",
          ...moderationPayload(actor, row.user_id, input),
        },
      });
    appendModeratorLog(
      ctx,
      actor,
      "thread.restore",
      "thread",
      row.id,
      input.reason,
      {},
      row.node_id,
    );
  });
  return threadValue(ctx, actor, row.id);
});

function changePostState(ctx: Ctx, id: number, state: State): boolean {
  const post = postRow(ctx, id)!;
  const thread = threadRow(ctx, post.thread_id)!;
  if (post.state === state) return false;
  const before = post.state === "visible";
  const after = state === "visible";
  forumDb(ctx).prepare("UPDATE posts SET state = ?1 WHERE id = ?2").run(state, post.id);
  forumDb(ctx)
    .prepare("UPDATE threads SET content_updated_at = ?1 WHERE id = ?2")
    .run(ctx.now(), thread.id);
  if (before !== after) {
    const delta = after ? 1 : -1;
    forumDb(ctx)
      .prepare("UPDATE threads SET reply_count = reply_count + ?1 WHERE id = ?2")
      .run(delta, thread.id);
    updateThreadLast(ctx, thread.id);
    if (thread.state === "visible") {
      forumDb(ctx)
        .prepare("UPDATE nodes SET post_count = post_count + ?1 WHERE id = ?2")
        .run(delta, thread.node_id);
      forumDb(ctx)
        .prepare("UPDATE users SET post_count = post_count + ?1 WHERE id = ?2")
        .run(delta, post.user_id);
      updateNodeLast(ctx, thread.node_id);
    }
  }
  return true;
}
export const postsDeleteOp = implement(contracts.postsDelete, (ctx, actor, input) => {
  requireAuthenticated(actor);
  const { post, thread } = requirePost(ctx, actor, input.postId);
  if (!mayDelete(permissionsOf(ctx, actor), thread.row.node_id, post.user_id, thread.row.is_locked))
    throw new ForbiddenError();
  if (post.id === thread.row.first_post_id) throw new ValidationError("Delete the thread instead.");
  if (post.state === "deleted") throw new ValidationError("The post is already deleted.");
  writeTx(ctx, () => {
    if (changePostState(ctx, post.id, "deleted"))
      publishEvent(ctx, {
        type: "content.deleted",
        targetType: "post",
        targetId: post.id,
        payload: {
          previousState: post.state,
          state: "deleted",
          ...moderationPayload(actor, post.user_id, input),
        },
      });
    if (can(ctx, actor, "forum.deleteAny", { nodeId: thread.row.node_id }))
      appendModeratorLog(
        ctx,
        actor,
        "post.delete",
        "post",
        post.id,
        input.reason,
        {},
        thread.row.node_id,
      );
  });
  return postValue(ctx, actor, post.id);
});
export const postsRestoreOp = implement(contracts.postsRestore, (ctx, actor, input) => {
  requireAuthenticated(actor);
  const { post, thread } = requirePost(ctx, actor, input.postId);
  const nodeId = thread.row.node_id;
  if (post.state === "moderated") requirePermission(ctx, actor, "forum.approve", { nodeId });
  else if (post.state === "deleted") requirePermission(ctx, actor, "forum.undelete", { nodeId });
  else if (
    !can(ctx, actor, "forum.undelete", { nodeId }) &&
    !can(ctx, actor, "forum.approve", { nodeId })
  )
    throw new ForbiddenError();
  writeTx(ctx, () => {
    if (changePostState(ctx, post.id, "visible"))
      publishEvent(ctx, {
        type: "content.state_changed",
        targetType: "post",
        targetId: post.id,
        payload: {
          previousState: post.state,
          state: "visible",
          ...moderationPayload(actor, post.user_id, input),
        },
      });
    appendModeratorLog(
      ctx,
      actor,
      "post.restore",
      "post",
      post.id,
      input.reason,
      {},
      thread.row.node_id,
    );
  });
  return postValue(ctx, actor, post.id);
});
export const threadsMarkReadOp = implement(contracts.threadsMarkRead, (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  const { row } = requireThread(ctx, actor, input.threadId);
  return writeTx(ctx, () => {
    const post = forumDb(ctx)
      .prepare<{ id: number; position: number }, [number, number]>(forumSql.readPost)
      .get(row.id, input.position);
    if (!post) throw new Error("Visible post missing at read position.");
    return { readPosition: markRead(ctx, user.userId, row.id, post.id, post.position) };
  });
});

type TransferPost = {
  id: number;
  position: number;
  user_id: number;
  state: State;
  created_at: number;
};

/** One bounded transaction. A tombstone can retain posts until its queued chunks finish. */
export function mergeThreadChunk(
  ctx: Ctx,
  targetId: number,
  sourceId: number,
  base: number,
  sourceVisible: boolean,
): number {
  return writeTx(ctx, () => {
    const target = threadRow(ctx, targetId);
    const source = threadRow(ctx, sourceId);
    if (!target || !source || target.merged_into_id != null) return 0;
    if (source.state !== "deleted" || source.merged_into_id !== targetId)
      throw new ConflictError(REORGANIZING);
    const posts = statement<TransferPost, [number, number]>(
      ctx,
      "mergeChunkPosts",
      "SELECT id, position, user_id, state, created_at FROM posts WHERE thread_id = ?1 ORDER BY position LIMIT ?2",
    ).all(sourceId, 500);
    if (!posts.length) {
      forumDb(ctx)
        .prepare(
          "UPDATE threads SET first_post_id = NULL, reply_count = 0, last_post_id = NULL, last_post_at = created_at, last_poster_id = user_id WHERE id = ?1",
        )
        .run(sourceId);
      return 0;
    }
    const ids = JSON.stringify(posts.map((post) => post.id));
    const visible = posts.filter((post) => post.state === "visible");
    const authors = new Map<number, number>();
    for (const post of visible) authors.set(post.user_id, (authors.get(post.user_id) ?? 0) + 1);
    forumDb(ctx)
      .prepare(
        "UPDATE posts SET thread_id = ?1, position = position + ?2 WHERE id IN (SELECT value FROM json_each(?3)) AND thread_id = ?4",
      )
      .run(targetId, base, ids, sourceId);
    forumDb(ctx)
      .prepare("UPDATE threads SET reply_count = reply_count + ?1 WHERE id = ?2")
      .run(visible.length, targetId);
    forumDb(ctx)
      .prepare("UPDATE threads SET reply_count = MAX(0, reply_count - ?1) WHERE id = ?2")
      .run(visible.length, sourceId);
    if (target.state === "visible") {
      forumDb(ctx)
        .prepare("UPDATE nodes SET post_count = post_count + ?1 WHERE id = ?2")
        .run(visible.length, target.node_id);
    }
    const userDelta = Number(target.state === "visible") - Number(sourceVisible);
    if (userDelta) {
      const adjust = forumDb(ctx).prepare(
        "UPDATE users SET post_count = post_count + ?1 WHERE id = ?2",
      );
      for (const [userId, count] of authors) adjust.run(count * userDelta, userId);
    }
    forumDb(ctx)
      .prepare(
        "UPDATE report_groups SET node_id = ?1 WHERE target_type = 'post' AND target_id IN (SELECT value FROM json_each(?2))",
      )
      .run(target.node_id, ids);
    forumDb(ctx)
      .prepare(
        "UPDATE moderator_log SET node_id = ?1 WHERE target_type = 'post' AND target_id IN (SELECT value FROM json_each(?2))",
      )
      .run(target.node_id, ids);
    if (visible.length) updateThreadLast(ctx, targetId);
    if (posts.some((post) => post.id === source.first_post_id))
      forumDb(ctx)
        .prepare("UPDATE post_bodies SET body_source = body_source WHERE post_id = ?1")
        .run(source.first_post_id);
    if (posts.length < 500)
      forumDb(ctx)
        .prepare(
          "UPDATE threads SET first_post_id = NULL, reply_count = 0, last_post_id = NULL, last_post_at = created_at, last_poster_id = user_id WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM posts WHERE thread_id = ?1)",
        )
        .run(sourceId);
    updateNodeLast(ctx, target.node_id);
    return posts.length;
  });
}

const mergeJobKey = (targetId: number, sourceId: number) => `forums.merge.${targetId}.${sourceId}`;
const finalizeJobKey = (targetId: number) => `forums.mergeFinalize.${targetId}`;
const splitJobKey = (targetId: number) => `forums.split.${targetId}`;
function jobKeyHeld(ctx: Ctx, key: string): boolean {
  return !!statement<{ id: number }, [string]>(
    ctx,
    "jobKeyHeld",
    "SELECT id FROM jobs WHERE unique_key = ?1",
  ).get(key);
}
/** Queues a transfer chunk's successor; a held key throws, so the chunk rolls back and retries. */
function enqueueSuccessor(
  ctx: Ctx,
  type: string,
  payload: unknown,
  options: { uniqueKey: string },
): void {
  if (enqueueJob(ctx, type, payload, options) === null)
    throw new Error(`Transfer job ${options.uniqueKey} is already queued.`);
}
function retryFailedJob(ctx: Ctx, key: string): void {
  forumDb(ctx)
    .prepare(
      "UPDATE jobs SET status = 'pending', attempts = 0, run_at = ?1, last_error = NULL, updated_at = ?1 WHERE unique_key = ?2 AND status = 'failed'",
    )
    .run(ctx.now(), key);
}

/**
 * Transfer jobs run one chunk per job. Each chunk derives its progress from the database, and its
 * successor is queued under the same key in the transaction that writes the chunk and completes
 * the running job, so a replayed or superseded run no longer owns its job and does nothing.
 */
export function registerForumTransferJobs(ctx: Ctx): void {
  registerJobHandler(
    ctx,
    "forums.merge",
    async (context, payload, job) => {
      const state = payload as MergeJobState;
      const key = mergeJobKey(state.targetId, state.sourceId);
      writeTx(context, () => {
        if (!completeRunningJob(context, job)) return;
        const target = threadRow(context, state.targetId);
        if (!target || target.merged_into_id != null) return;
        const { targetId, sourceId, base, sourceVisible } = state;
        if (
          mergeThreadChunk(context, targetId, sourceId, base, sourceVisible) > 0 ||
          moveMergeMetadataChunk(context, targetId, sourceId, base) > 0
        ) {
          enqueueSuccessor(context, "forums.merge", state, { uniqueKey: key });
          return;
        }
        // The last source to finish queues the renumbering; a failed source keeps its key.
        const others = state.finalState.sourceIds.some(
          (id) => id !== sourceId && jobKeyHeld(context, mergeJobKey(targetId, id)),
        );
        if (!others && target.transfer_role)
          enqueueSuccessor(context, "forums.mergeFinalize", state.finalState, {
            uniqueKey: finalizeJobKey(targetId),
          });
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
    },
    { onFailed: transferFailed("forums.merge") },
  );
  registerJobHandler(
    ctx,
    "forums.mergeFinalize",
    async (context, payload, job) => {
      const state = mergeFinalizeState.parse(payload);
      const key = finalizeJobKey(state.targetId);
      writeTx(context, () => {
        if (!completeRunningJob(context, job)) return;
        const target = threadRow(context, state.targetId);
        if (target?.transfer_role !== "merge_target" || target.merged_into_id != null) return;
        // An unfinished source queues the renumbering again when it finishes.
        if (state.sourceIds.some((id) => jobKeyHeld(context, mergeJobKey(state.targetId, id))))
          return;
        const next = renumberMergeChunk(context, state);
        if (next) enqueueSuccessor(context, "forums.mergeFinalize", next, { uniqueKey: key });
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
    },
    { onFailed: transferFailed("forums.mergeFinalize") },
  );
  registerJobHandler(
    ctx,
    "forums.split",
    async (context, payload, job) => {
      const state = payload as SplitJobState;
      const { sourceId, targetId, fromPosition, throughPosition } = state;
      const key = splitJobKey(targetId);
      writeTx(context, () => {
        if (!completeRunningJob(context, job)) return;
        const target = threadRow(context, targetId);
        if (!target || target.merged_into_id != null) return;
        let moved = state.pendingReads;
        if (!moved) {
          const posts = statement<TransferPost, [number, number, number, number]>(
            context,
            "splitJobRange",
            "SELECT id, position, user_id, state, created_at FROM posts WHERE thread_id = ?1 AND position BETWEEN ?2 AND ?4 ORDER BY position LIMIT ?3",
          ).all(sourceId, fromPosition, 500, throughPosition);
          moved = posts.length ? applySplitChunk(context, sourceId, targetId, posts) : [];
        }
        if (moved.length) {
          const cursor = moveSplitReadMarkers(context, sourceId, targetId, moved, state.readCursor);
          if (cursor !== null) {
            enqueueSuccessor(
              context,
              "forums.split",
              { ...state, pendingReads: moved, readCursor: cursor },
              { uniqueKey: key },
            );
            return;
          }
        }
        const remaining = statement<{ id: number }, [number, number, number]>(
          context,
          "splitJobRemaining",
          "SELECT id FROM posts WHERE thread_id = ?1 AND position BETWEEN ?2 AND ?3 ORDER BY position LIMIT 1",
        ).get(sourceId, fromPosition, throughPosition);
        if (remaining)
          enqueueSuccessor(
            context,
            "forums.split",
            { sourceId, targetId, fromPosition, throughPosition, moderatorId: state.moderatorId },
            { uniqueKey: key },
          );
        else finishTransfer(context, `forums.split.${targetId}`);
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
    },
    { onFailed: transferFailed("forums.split") },
  );
}

type MergeJobState = {
  targetId: number;
  sourceId: number;
  base: number;
  sourceVisible: boolean;
  finalState: MergeFinalizeState;
  moderatorId?: number | null;
};

type SplitJobState = {
  sourceId: number;
  targetId: number;
  fromPosition: number;
  throughPosition: number;
  moderatorId?: number | null;
  pendingReads?: { id: number; position: number; newPosition: number }[];
  readCursor?: number;
  selectedIds?: number[];
};

/**
 * Runs when the queue gives up on a transfer job: the job keeps its key, so a moderator's retry
 * finds it with one lookup, and the transfer's guard rows record the failure.
 */
function transferFailed(type: "forums.merge" | "forums.mergeFinalize" | "forums.split") {
  return (ctx: Ctx, job: { id: number; payload: unknown; error: string }): void => {
    const { targetId, sourceId, moderatorId } = job.payload as {
      targetId: number;
      sourceId: number;
      moderatorId?: number | null;
    };
    forumDb(ctx)
      .prepare("UPDATE jobs SET unique_key = ?1 WHERE id = ?2")
      .run(
        type === "forums.merge"
          ? mergeJobKey(targetId, sourceId)
          : type === "forums.split"
            ? splitJobKey(targetId)
            : finalizeJobKey(targetId),
        job.id,
      );
    forumDb(ctx)
      .prepare("UPDATE thread_transfers SET failed_at = ?1 WHERE job_key = ?2")
      .run(ctx.now(), `forums.${type === "forums.split" ? "split" : "merge"}.${targetId}`);
    if (moderatorId == null) return;
    try {
      // Its own savepoint: a failed audit entry must not undo the key and guard updates above.
      writeTx(ctx, () =>
        forumDb(ctx)
          .prepare(
            "INSERT INTO moderator_log (actor_id, action, target_type, target_id, reason, details, created_at, node_id) VALUES (?1, 'thread.transfer.failed', 'thread', ?2, ?3, ?4, ?5, ?6)",
          )
          .run(
            moderatorId,
            targetId,
            job.error,
            JSON.stringify({ type }),
            ctx.now(),
            threadRow(ctx, targetId)?.node_id ?? null,
          ),
      );
    } catch (error) {
      console.error("[forums.transferFailed]", error);
    }
  };
}

const jobIds = z.array(z.number().int()).min(1);
const mergeFinalizeState = z
  .object({
    targetId: z.number().int().positive(),
    sourceIds: jobIds,
    /** Position ranges [start, end) of the target's own posts and of each moved source. */
    streamStarts: jobIds,
    streamEnds: jobIds,
    /** Absent while streams are merged; then posts flip back, then read markers follow. */
    phase: z.enum(["flip", "reads"]).optional(),
    readCursor: z.number().int().optional(),
    moderatorId: z.number().int().nullable().optional(),
  })
  .refine((state) => state.streamStarts.length === state.streamEnds.length, {
    message: "Merge stream bounds do not match.",
  });
type MergeFinalizeState = z.infer<typeof mergeFinalizeState>;

/**
 * One chunk of renumbering the target in creation order. The streams step writes final position
 * p as -(p + 1), so finished posts drop out of the stream ranges and the lowest position gives the
 * next one; the flip step turns negative positions back. Returns null once read markers follow.
 */
function renumberMergeChunk(ctx: Ctx, state: MergeFinalizeState): MergeFinalizeState | null {
  return writeTx(ctx, () => {
    if (state.phase === "reads") {
      const readers = statement<{ user_id: number }, [number, number]>(
        ctx,
        "mergeRepositionReaders",
        "SELECT user_id FROM thread_reads WHERE thread_id = ?1 AND user_id > ?2 ORDER BY user_id LIMIT 500",
      ).all(state.targetId, state.readCursor ?? 0);
      const update = forumDb(ctx).prepare(
        "UPDATE thread_reads SET last_read_position = COALESCE((SELECT position FROM posts WHERE id = last_read_post_id AND thread_id = ?1), MIN(last_read_position, COALESCE((SELECT MAX(position) FROM posts WHERE thread_id = ?1), 0))) WHERE thread_id = ?1 AND user_id = ?2",
      );
      for (const reader of readers) update.run(state.targetId, reader.user_id);
      if (readers.length) return { ...state, readCursor: readers.at(-1)!.user_id };
      updateThreadLast(ctx, state.targetId);
      const target = threadRow(ctx, state.targetId)!;
      if (target.state === "visible") updateNodeLast(ctx, target.node_id);
      finishTransfer(ctx, `forums.merge.${state.targetId}`);
      return null;
    }
    const update = forumDb(ctx).prepare("UPDATE posts SET position = ?1 WHERE id = ?2");
    if (state.phase === "flip") {
      const posts = statement<{ id: number; position: number }, [number]>(
        ctx,
        "mergeFlipPositions",
        "SELECT id, position FROM posts WHERE thread_id = ?1 AND position < 0 ORDER BY position DESC LIMIT 500",
      ).all(state.targetId);
      for (const post of posts) update.run(-post.position - 1, post.id);
      return posts.length ? state : { ...state, phase: "reads", readCursor: 0 };
    }
    const lowest =
      statement<{ position: number }, [number]>(
        ctx,
        "minPostPosition",
        "SELECT position FROM posts WHERE thread_id = ?1 ORDER BY position LIMIT 1",
      ).get(state.targetId)?.position ?? 0;
    let next = lowest < 0 ? -lowest : 1;
    const streams = state.streamStarts.map((start, index) =>
      statement<TransferPost, [number, number, number]>(
        ctx,
        "mergeOrderedStream",
        "SELECT id, position, user_id, state, created_at FROM posts WHERE thread_id = ?1 AND position >= ?2 AND position < ?3 ORDER BY position LIMIT 500",
      ).all(state.targetId, start, state.streamEnds[index]!),
    );
    const indexes = streams.map(() => 0);
    let count = 0;
    while (count < 500) {
      let best = -1;
      for (let i = 0; i < streams.length; i++) {
        const row = streams[i]![indexes[i]!];
        const chosen = best < 0 ? undefined : streams[best]![indexes[best]!];
        if (
          row &&
          (!chosen ||
            row.created_at < chosen.created_at ||
            (row.created_at === chosen.created_at && row.id < chosen.id))
        )
          best = i;
      }
      if (best < 0) break;
      update.run(-next - 1, streams[best]![indexes[best]!]!.id);
      indexes[best]!++;
      next++;
      count++;
    }
    return count ? state : { ...state, phase: "flip" };
  });
}

function moveMergeNotifications(ctx: Ctx, targetId: number, sourceId: number): number {
  return writeTx(ctx, () => {
    const moved = forumDb(ctx)
      .prepare(
        "UPDATE notifications SET thread_id = ?1 WHERE id IN (SELECT id FROM notifications WHERE thread_id = ?2 AND read_at IS NULL ORDER BY id LIMIT 500)",
      )
      .run(targetId, sourceId).changes;
    if (moved) return moved;
    const content = forumDb(ctx)
      .prepare(
        "UPDATE notifications SET content_id = ?1 WHERE id IN (SELECT id FROM notifications WHERE content_type = 'thread' AND content_id = ?2 AND read_at IS NULL ORDER BY id LIMIT 500)",
      )
      .run(targetId, sourceId).changes;
    return content;
  });
}

function moveMergeMetadataChunk(
  ctx: Ctx,
  targetId: number,
  sourceId: number,
  base: number,
): number {
  return (
    writeTx(ctx, () => {
      const reads = statement<{ user_id: number }, [number]>(
        ctx,
        "mergeReadBatch",
        "SELECT user_id FROM thread_reads WHERE thread_id = ?1 ORDER BY user_id LIMIT 500",
      ).all(sourceId);
      if (reads.length) {
        const ids = JSON.stringify(reads.map((row) => row.user_id));
        forumDb(ctx)
          .prepare(
            "INSERT INTO thread_reads (user_id, thread_id, last_read_post_id, last_read_position, read_at) SELECT user_id, ?1, last_read_post_id, last_read_position + ?2, read_at FROM thread_reads WHERE thread_id = ?3 AND user_id IN (SELECT value FROM json_each(?4)) ON CONFLICT(user_id, thread_id) DO UPDATE SET last_read_post_id = excluded.last_read_post_id, last_read_position = excluded.last_read_position, read_at = excluded.read_at WHERE excluded.last_read_post_id > thread_reads.last_read_post_id",
          )
          .run(targetId, base, sourceId, ids);
        forumDb(ctx)
          .prepare(
            "DELETE FROM thread_reads WHERE thread_id = ?1 AND user_id IN (SELECT value FROM json_each(?2))",
          )
          .run(sourceId, ids);
        return reads.length;
      }
      const watches = statement<{ user_id: number }, [number]>(
        ctx,
        "mergeWatchBatch",
        "SELECT user_id FROM thread_watches WHERE thread_id = ?1 ORDER BY user_id LIMIT 500",
      ).all(sourceId);
      if (watches.length) {
        const ids = JSON.stringify(watches.map((row) => row.user_id));
        forumDb(ctx)
          .prepare(
            "INSERT INTO thread_watches (user_id, thread_id, email, created_at) SELECT user_id, ?1, email, created_at FROM thread_watches WHERE thread_id = ?2 AND user_id IN (SELECT value FROM json_each(?3)) ON CONFLICT(thread_id, user_id) DO UPDATE SET email = MAX(email, excluded.email)",
          )
          .run(targetId, sourceId, ids);
        forumDb(ctx)
          .prepare(
            "DELETE FROM thread_watches WHERE thread_id = ?1 AND user_id IN (SELECT value FROM json_each(?2))",
          )
          .run(sourceId, ids);
        return watches.length;
      }
      const bans = statement<{ user_id: number }, [number]>(
        ctx,
        "mergeBanBatch",
        "SELECT user_id FROM thread_bans WHERE thread_id = ?1 ORDER BY user_id LIMIT 500",
      ).all(sourceId);
      if (bans.length) {
        const ids = JSON.stringify(bans.map((row) => row.user_id));
        forumDb(ctx)
          .prepare(
            "INSERT INTO thread_bans (thread_id, user_id, moderator_id, reason, created_at, expires_at) SELECT ?1, user_id, moderator_id, reason, created_at, expires_at FROM thread_bans WHERE thread_id = ?2 AND user_id IN (SELECT value FROM json_each(?3)) ON CONFLICT(thread_id, user_id) DO UPDATE SET expires_at = CASE WHEN thread_bans.expires_at IS NULL OR excluded.expires_at IS NULL THEN NULL ELSE MAX(thread_bans.expires_at, excluded.expires_at) END",
          )
          .run(targetId, sourceId, ids);
        forumDb(ctx)
          .prepare(
            "DELETE FROM thread_bans WHERE thread_id = ?1 AND user_id IN (SELECT value FROM json_each(?2))",
          )
          .run(sourceId, ids);
        return bans.length;
      }
      return 0;
    }) || moveMergeNotifications(ctx, targetId, sourceId)
  );
}

function applySplitChunk(
  ctx: Ctx,
  sourceId: number,
  targetId: number,
  posts: TransferPost[],
): { id: number; position: number; newPosition: number }[] {
  const source = threadRow(ctx, sourceId)!;
  const target = threadRow(ctx, targetId)!;
  const start =
    (statement<{ position: number }, [number]>(
      ctx,
      "maxPostPosition",
      forumSql.maxPostPosition,
    ).get(targetId)?.position ?? -1) + 1;
  const moved = posts.map((post, index) => ({ ...post, newPosition: start + index }));
  const update = forumDb(ctx).prepare(
    "UPDATE posts SET thread_id = ?1, position = ?2 WHERE id = ?3 AND thread_id = ?4",
  );
  for (const post of moved) update.run(targetId, post.newPosition, post.id, sourceId);
  const first = moved[0]!;
  if (start === 0) {
    forumDb(ctx)
      .prepare(
        "UPDATE threads SET first_post_id = ?1, last_post_id = ?1, last_post_at = ?2, last_poster_id = ?3 WHERE id = ?4",
      )
      .run(first.id, first.created_at ?? ctx.now(), first.user_id, targetId);
    forumDb(ctx)
      .prepare("UPDATE post_bodies SET body_source = body_source WHERE post_id = ?1")
      .run(first.id);
  }
  const visible = moved.filter((post) => post.state === "visible");
  forumDb(ctx)
    .prepare("UPDATE threads SET reply_count = reply_count + ?1 WHERE id = ?2")
    .run(visible.length - (start === 0 ? 1 : 0), targetId);
  forumDb(ctx)
    .prepare("UPDATE threads SET reply_count = reply_count - ?1 WHERE id = ?2")
    .run(visible.length, sourceId);
  if (visible.length) updateThreadLast(ctx, targetId);
  updateThreadLast(ctx, sourceId);
  if (source.state === "visible") {
    forumDb(ctx)
      .prepare("UPDATE nodes SET post_count = post_count - ?1 WHERE id = ?2")
      .run(visible.length, source.node_id);
  }
  if (target.state === "visible") {
    forumDb(ctx)
      .prepare("UPDATE nodes SET post_count = post_count + ?1 WHERE id = ?2")
      .run(visible.length, target.node_id);
  }
  if (source.state === "visible" || target.state === "visible") {
    updateNodeLast(ctx, source.node_id);
    updateNodeLast(ctx, target.node_id);
  }
  if (source.state !== target.state) {
    const adjust = forumDb(ctx).prepare(
      "UPDATE users SET post_count = post_count + ?1 WHERE id = ?2",
    );
    for (const post of visible)
      adjust.run(
        Number(target.state === "visible") - Number(source.state === "visible"),
        post.user_id,
      );
  }
  const ids = JSON.stringify(moved.map((post) => post.id));
  forumDb(ctx)
    .prepare(
      "UPDATE report_groups SET node_id = ?1 WHERE target_type = 'post' AND target_id IN (SELECT value FROM json_each(?2))",
    )
    .run(target.node_id, ids);
  forumDb(ctx)
    .prepare(
      "UPDATE moderator_log SET node_id = ?1 WHERE target_type = 'post' AND target_id IN (SELECT value FROM json_each(?2))",
    )
    .run(target.node_id, ids);
  forumDb(ctx)
    .prepare(
      "UPDATE notifications SET thread_id = ?1 WHERE content_type = 'post' AND content_id IN (SELECT value FROM json_each(?2))",
    )
    .run(targetId, ids);
  return moved;
}

function moveSplitReadMarkers(
  ctx: Ctx,
  sourceId: number,
  targetId: number,
  moved: { id: number; position: number; newPosition: number }[],
  cursor = 0,
): number | null {
  const readers = statement<
    { user_id: number; last_read_post_id: number; last_read_position: number },
    [number, number]
  >(
    ctx,
    "splitReaders",
    "SELECT user_id, last_read_post_id, last_read_position FROM thread_reads INDEXED BY thread_reads_thread WHERE thread_id = ?1 AND user_id > ?2 ORDER BY user_id LIMIT 500",
  ).all(sourceId, cursor);
  for (const reader of readers) {
    const seen = moved.findLast((post) => post.position <= reader.last_read_position);
    if (seen)
      forumDb(ctx)
        .prepare(
          "INSERT INTO thread_reads (user_id, thread_id, last_read_post_id, last_read_position, read_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(user_id, thread_id) DO UPDATE SET last_read_post_id = excluded.last_read_post_id, last_read_position = excluded.last_read_position, read_at = excluded.read_at WHERE excluded.last_read_post_id > thread_reads.last_read_post_id",
        )
        .run(reader.user_id, targetId, seen.id, seen.newPosition, ctx.now());
    if (moved.some((post) => post.id === reader.last_read_post_id)) {
      const remaining = statement<{ id: number; position: number }, [number, number]>(
        ctx,
        "splitSourceReadAnchor",
        "SELECT id, position FROM posts WHERE thread_id = ?1 AND position <= ?2 ORDER BY position DESC LIMIT 1",
      ).get(sourceId, reader.last_read_position);
      if (remaining)
        forumDb(ctx)
          .prepare(
            "UPDATE thread_reads SET last_read_post_id = ?1, last_read_position = ?2 WHERE thread_id = ?3 AND user_id = ?4",
          )
          .run(remaining.id, remaining.position, sourceId, reader.user_id);
      else
        forumDb(ctx)
          .prepare("DELETE FROM thread_reads WHERE thread_id = ?1 AND user_id = ?2")
          .run(sourceId, reader.user_id);
    }
  }
  return readers.length === 500 ? readers.at(-1)!.user_id : null;
}

export const threadsSplitOp = implement(contracts.threadsSplit, (ctx, actor, input) => {
  const { row: source } = requireThread(ctx, actor, input.threadId);
  requirePermission(ctx, actor, "forum.split", { nodeId: source.node_id });
  const { node } = requireNode(ctx, actor, input.nodeId);
  if (node.type !== "forum") throw new ValidationError("Threads can only be split into forums.");
  requirePermission(ctx, actor, "forum.split", { nodeId: input.nodeId });
  if (source.transfer_role === "split_source" && source.transfer_failed_at != null) {
    // Retrying the same request resumes the failed split into the thread it already created.
    const transfer = statement<{ other_thread_id: number }, [number]>(
      ctx,
      "transferOther",
      "SELECT other_thread_id FROM thread_transfers WHERE thread_id = ?1",
    ).get(source.id);
    const target = transfer ? threadRow(ctx, transfer.other_thread_id) : undefined;
    const failed = target
      ? statement<{ payload: string }, [string]>(
          ctx,
          "failedTransferJob",
          "SELECT payload FROM jobs WHERE unique_key = ?1 AND status = 'failed'",
        ).get(splitJobKey(target.id))
      : null;
    const job = failed ? (JSON.parse(failed.payload) as SplitJobState) : null;
    if (
      target &&
      job &&
      target.node_id === input.nodeId &&
      target.title === input.title &&
      (input.postIds
        ? JSON.stringify(job.selectedIds) ===
          JSON.stringify([...input.postIds].sort((a, b) => a - b))
        : job.selectedIds === undefined && job.fromPosition === input.fromPosition)
    ) {
      writeTx(ctx, () => {
        forumDb(ctx)
          .prepare("UPDATE thread_transfers SET failed_at = NULL WHERE job_key = ?1")
          .run(`forums.split.${target.id}`);
        retryFailedJob(ctx, splitJobKey(target.id));
      });
      return { thread: threadValue(ctx, actor, target.id), completed: false };
    }
  }
  assertTransferIdle(ctx, input.threadId);
  if ((input.postIds === undefined) === (input.fromPosition === undefined))
    throw new ValidationError("Choose postIds or fromPosition.");
  const result = writeTx(ctx, () => {
    assertTransferIdle(ctx, source.id);
    const current = threadRow(ctx, source.id)!;
    if (current.state !== source.state || current.node_id !== source.node_id)
      throw new ConflictError("Thread changed; retry.");
    const throughPosition =
      statement<{ position: number }, [number]>(
        ctx,
        "maxPostPosition",
        forumSql.maxPostPosition,
      ).get(source.id)?.position ?? -1;
    const posts = input.postIds
      ? statement<TransferPost, [number, string]>(
          ctx,
          "splitSelected",
          "SELECT id, position, user_id, state, created_at FROM posts WHERE thread_id = ?1 AND id IN (SELECT value FROM json_each(?2)) ORDER BY position",
        ).all(source.id, JSON.stringify(input.postIds))
      : statement<TransferPost, [number, number, number]>(
          ctx,
          "splitRange",
          "SELECT id, position, user_id, state, created_at FROM posts WHERE thread_id = ?1 AND position >= ?2 ORDER BY position LIMIT ?3",
        ).all(source.id, input.fromPosition!, 1);
    if (!posts.length || (input.postIds && posts.length !== new Set(input.postIds).size))
      throw new NotFoundError();
    if (posts.some((post) => post.id === source.first_post_id))
      throw new ValidationError("The thread's first post cannot move.");
    if (posts[0]!.state !== "visible")
      throw new ValidationError("The new thread's first post must be visible.");
    const first = posts[0]!;
    const body = statement<{ body_source: string }, [number]>(
      ctx,
      "splitFirstBody",
      "SELECT body_source FROM post_bodies WHERE post_id = ?1",
    ).get(first.id)!;
    const target = forumDb(ctx)
      .prepare<{ id: number }, [number, number, string, State, number, string]>(
        "INSERT INTO threads (node_id, user_id, title, state, created_at, last_post_at, last_poster_id, content_updated_at, excerpt) VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?2, ?5, ?6) RETURNING id",
      )
      .get(
        input.nodeId,
        first.user_id,
        input.title,
        source.state,
        first.created_at ?? ctx.now(),
        excerptFromMarkdown(body.body_source),
      )!;
    // Members banned from the source stay banned from the posts that leave it.
    forumDb(ctx)
      .prepare(
        "INSERT INTO thread_bans (thread_id, user_id, moderator_id, reason, created_at, expires_at) SELECT ?1, user_id, moderator_id, reason, created_at, expires_at FROM thread_bans WHERE thread_id = ?2 AND (expires_at IS NULL OR expires_at > ?3)",
      )
      .run(target.id, source.id, ctx.now());
    const moved = applySplitChunk(ctx, source.id, target.id, posts);
    const readCursor = moveSplitReadMarkers(ctx, source.id, target.id, moved);
    if (source.state === "visible") {
      forumDb(ctx)
        .prepare("UPDATE nodes SET thread_count = thread_count + 1 WHERE id = ?1")
        .run(input.nodeId);
      updateNodeLast(ctx, input.nodeId);
    }
    appendModeratorLog(
      ctx,
      actor,
      "thread.split",
      "thread",
      target.id,
      input.reason,
      { sourceId: source.id },
      input.nodeId,
    );
    publishEvent(ctx, {
      type: "moderation.action",
      targetType: "thread",
      targetId: target.id,
      payload: {
        action: "split",
        moderatorId: actorUserId(actor),
        contentUserId: first.user_id,
        sourceId: source.id,
        reason: input.reason,
        notify: input.notify,
        message: input.message,
      },
    });
    const morePosts =
      input.fromPosition !== undefined &&
      !!statement<{ id: number }, [number, number, number]>(
        ctx,
        "splitRemaining",
        "SELECT id FROM posts WHERE thread_id = ?1 AND position BETWEEN ?2 AND ?3 ORDER BY position LIMIT 1",
      ).get(source.id, input.fromPosition, throughPosition);
    const more = morePosts || readCursor !== null;
    if (more) {
      const jobKey = `forums.split.${target.id}`;
      markTransfer(ctx, source.id, "split_source", target.id, jobKey);
      markTransfer(ctx, target.id, "split_target", source.id, jobKey);
      enqueueJob(
        ctx,
        "forums.split",
        {
          sourceId: source.id,
          targetId: target.id,
          fromPosition: input.fromPosition ?? Number.MAX_SAFE_INTEGER,
          throughPosition,
          moderatorId: actorUserId(actor),
          ...(input.postIds ? { selectedIds: [...input.postIds].sort((a, b) => a - b) } : {}),
          ...(readCursor === null ? {} : { pendingReads: moved, readCursor }),
        },
        { uniqueKey: splitJobKey(target.id) },
      );
    }
    return { targetId: target.id, more };
  });
  return { thread: threadValue(ctx, actor, result.targetId), completed: !result.more };
});

export const threadsMergeOp = implement(contracts.threadsMerge, (ctx, actor, input) => {
  const { row: target } = requireThread(ctx, actor, input.threadId);
  requirePermission(ctx, actor, "forum.merge", { nodeId: target.node_id });
  if (
    new Set(input.sourceThreadIds).size !== input.sourceThreadIds.length ||
    input.sourceThreadIds.includes(target.id)
  )
    throw new ValidationError("Choose distinct source threads other than the target.");
  if (target.transfer_role === "merge_target" && target.transfer_failed_at != null) {
    // Retrying a failed merge requeues its failed jobs as they were; the guard table is tiny.
    const jobKey = `forums.merge.${target.id}`;
    const retrySources = statement<{ thread_id: number }, [string]>(
      ctx,
      "mergeTransferSources",
      "SELECT thread_id FROM thread_transfers WHERE job_key = ?1 AND role = 'merge_source'",
    )
      .all(jobKey)
      .map((row) => row.thread_id);
    if (input.sourceThreadIds.some((id) => !retrySources.includes(id)))
      throw new ConflictError(REORGANIZING);
    for (const id of retrySources)
      requirePermission(ctx, actor, "forum.merge", { nodeId: threadRow(ctx, id)!.node_id });
    writeTx(ctx, () => {
      forumDb(ctx)
        .prepare("UPDATE thread_transfers SET failed_at = NULL WHERE job_key = ?1")
        .run(jobKey);
      for (const id of retrySources) retryFailedJob(ctx, mergeJobKey(target.id, id));
      retryFailedJob(ctx, finalizeJobKey(target.id));
    });
    return { thread: threadValue(ctx, actor, target.id), completed: false };
  }
  assertTransferIdle(ctx, input.threadId, ...input.sourceThreadIds);
  const sources = input.sourceThreadIds.map((id) => requireThread(ctx, actor, id).row);
  for (const source of sources)
    requirePermission(ctx, actor, "forum.merge", { nodeId: source.node_id });
  const work = writeTx(ctx, () => {
    assertTransferIdle(ctx, target.id, ...input.sourceThreadIds);
    const currentTarget = threadRow(ctx, target.id);
    if (
      !currentTarget ||
      currentTarget.node_id !== target.node_id ||
      currentTarget.state !== target.state ||
      currentTarget.merged_into_id != null
    )
      throw new ConflictError("Target thread changed; retry.");
    let base =
      (statement<{ position: number }, [number]>(
        ctx,
        "maxPostPosition",
        forumSql.maxPostPosition,
      ).get(target.id)?.position ?? -1) + 1;
    const sourceMaxima = sources.map(
      (source) =>
        statement<{ position: number }, [number]>(
          ctx,
          "maxPostPosition",
          forumSql.maxPostPosition,
        ).get(source.id)?.position ?? -1,
    );
    let metadataRows = 0;
    for (const source of sources) {
      for (const [key, sql] of [
        [
          "mergeReadThreshold",
          "SELECT user_id FROM thread_reads WHERE thread_id = ?1 ORDER BY user_id LIMIT ?2",
        ],
        [
          "mergeWatchThreshold",
          "SELECT user_id FROM thread_watches WHERE thread_id = ?1 ORDER BY user_id LIMIT ?2",
        ],
        [
          "mergeBanThreshold",
          "SELECT user_id FROM thread_bans WHERE thread_id = ?1 ORDER BY user_id LIMIT ?2",
        ],
        [
          "mergeNoticeThreshold",
          "SELECT id FROM notifications WHERE thread_id = ?1 AND read_at IS NULL ORDER BY id LIMIT ?2",
        ],
        [
          "mergeContentNoticeThreshold",
          "SELECT id FROM notifications WHERE content_type = 'thread' AND content_id = ?1 AND read_at IS NULL ORDER BY id LIMIT ?2",
        ],
      ] as const) {
        metadataRows += statement<{ id: number }, [number, number]>(ctx, key, sql).all(
          source.id,
          501 - metadataRows,
        ).length;
        if (metadataRows > 500) break;
      }
      if (metadataRows > 500) break;
    }
    const metadataLarge = metadataRows > 500;
    const targetReaders = statement<{ user_id: number }, [number, number]>(
      ctx,
      "mergeTargetReadThreshold",
      "SELECT user_id FROM thread_reads WHERE thread_id = ?1 ORDER BY user_id LIMIT ?2",
    ).all(target.id, 501);
    const large =
      metadataLarge ||
      metadataRows + targetReaders.length > 500 ||
      base + sourceMaxima.reduce((sum, max) => sum + max + 1, 0) > 500;
    if (large)
      markTransfer(ctx, target.id, "merge_target", sources[0]!.id, `forums.merge.${target.id}`);
    const pending: {
      sourceId: number;
      base: number;
      max: number;
      large: boolean;
      sourceVisible: boolean;
    }[] = [];
    for (const [index, source] of sources.entries()) {
      const current = threadRow(ctx, source.id)!;
      if (
        current.state !== source.state ||
        current.node_id !== source.node_id ||
        ctx.sqlite
          .prepare<{ merged_into_id: number | null }, [number]>(
            "SELECT merged_into_id FROM threads WHERE id = ?1",
          )
          .get(source.id)?.merged_into_id != null
      )
        throw new ConflictError("Source thread changed; retry.");
      const max = sourceMaxima[index]!;
      const sourceVisible = current.state === "visible";
      if (large)
        markTransfer(ctx, source.id, "merge_source", target.id, `forums.merge.${target.id}`);
      forumDb(ctx)
        .prepare(
          "UPDATE threads SET state = 'deleted', merged_into_id = ?1, content_updated_at = ?2 WHERE id = ?3",
        )
        .run(target.id, ctx.now(), source.id);
      if (sourceVisible) {
        forumDb(ctx)
          .prepare(
            "UPDATE nodes SET thread_count = thread_count - 1, post_count = post_count - ?1 WHERE id = ?2",
          )
          .run(current.reply_count + 1, current.node_id);
        updateNodeLast(ctx, current.node_id);
      }
      forumDb(ctx)
        .prepare(
          "UPDATE moderator_log SET node_id = ?1 WHERE target_type = 'thread' AND target_id = ?2",
        )
        .run(target.node_id, source.id);
      appendModeratorLog(
        ctx,
        actor,
        "thread.merge",
        "thread",
        target.id,
        input.reason,
        { sourceId: source.id },
        target.node_id,
      );
      publishEvent(ctx, {
        type: "moderation.action",
        targetType: "thread",
        targetId: source.id,
        payload: {
          action: "merge",
          moderatorId: actorUserId(actor),
          contentUserId: source.user_id,
          targetId: target.id,
          reason: input.reason,
          notify: input.notify,
          message: input.message,
        },
      });
      pending.push({ sourceId: source.id, base, max, large, sourceVisible });
      base += max + 1;
    }
    const finalState: MergeFinalizeState = {
      targetId: target.id,
      sourceIds: pending.map((item) => item.sourceId),
      streamStarts: [1, ...pending.map((item) => item.base)],
      streamEnds: [pending[0]!.base, ...pending.map((item) => item.base + item.max + 1)],
      moderatorId: actorUserId(actor),
    };
    for (const item of pending) {
      if (item.large)
        enqueueJob(
          ctx,
          "forums.merge",
          {
            targetId: target.id,
            sourceId: item.sourceId,
            base: item.base,
            sourceVisible: item.sourceVisible,
            finalState,
            moderatorId: actorUserId(actor),
          },
          { uniqueKey: mergeJobKey(target.id, item.sourceId) },
        );
      else {
        mergeThreadChunk(ctx, target.id, item.sourceId, item.base, item.sourceVisible);
        while (moveMergeMetadataChunk(ctx, target.id, item.sourceId, item.base) > 0) {
          /* at most 500 rows of each indexed metadata set */
        }
      }
    }
    if (!large) {
      let next: MergeFinalizeState | null = finalState;
      while (next) next = renumberMergeChunk(ctx, next);
    }
    return pending;
  });
  return {
    thread: threadValue(ctx, actor, target.id),
    completed: !work.some((item) => item.large),
  };
});

export const operations = [
  nodesListOp,
  nodesGetOp,
  nodesCreateOp,
  nodesUpdateOp,
  nodesSetModeratorOp,
  threadsListOp,
  threadsGetOp,
  threadsCreateOp,
  threadsUpdateOp,
  threadsSetStickyOp,
  threadsSetLockedOp,
  threadsMoveOp,
  threadsDeleteOp,
  threadsRestoreOp,
  threadsMarkReadOp,
  threadsMergeOp,
  threadsSplitOp,
  postsListOp,
  postsGetOp,
  postsCreateOp,
  postsUpdateOp,
  postsDeleteOp,
  postsRestoreOp,
];
