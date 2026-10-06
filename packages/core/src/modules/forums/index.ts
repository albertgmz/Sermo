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
  getNodeTree,
  permissionsOf,
  permissionValue,
  requirePermission,
  resolvedPermissions,
  viewableNodeIds,
} from "../../permissions";
import { renderContent, storeContentReferences } from "../../render";
import { loadViewerReactions, reactionSummary } from "../../shared/reactions";
import { loadUserSummaries } from "../../shared/users";
import { iso, isoOrNull } from "../../time";
import { loadAttachments, setAttachments, validateEmbeddedAttachments } from "../attachments";
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
  thread_banned?: number;
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
const threadColumns =
  "id, node_id, user_id, title, state, is_sticky, is_locked, created_at, reply_count, view_count, first_post_id, last_post_at, last_post_id, last_poster_id";
const postColumns =
  "p.id, p.thread_id, p.user_id, p.position, p.state, p.created_at, p.edited_at, p.reaction_counts, p.attachment_count";
const nodeColumns =
  "id, icon_file_id, cover_file_id, thread_count, post_count, last_post_at, last_post_id, last_thread_id, last_thread_title, last_poster_id, require_thread_approval, require_reply_approval, is_read_only, min_account_age_days, min_post_count";
/** SQL shared by the hot paths and their query-plan tests. */
export const forumSql = {
  sticky: `SELECT ${threadColumns} FROM threads WHERE node_id = ?1 AND is_sticky = 1 AND (state = 'visible' OR (state = 'moderated' AND (?2 = 1 OR user_id = ?4)) OR (state = 'deleted' AND ?3 = 1)) ORDER BY last_post_at DESC, id DESC`,
  threadPage: `SELECT ${threadColumns} FROM threads WHERE node_id = ?1 AND is_sticky = 0 AND (state = 'visible' OR (state = 'moderated' AND (?2 = 1 OR user_id = ?7)) OR (state = 'deleted' AND ?3 = 1)) AND (last_post_at, id) < (?4, ?5) ORDER BY last_post_at DESC, id DESC LIMIT ?6`,
  postPage: `SELECT ${postColumns}, b.body_html FROM posts p JOIN post_bodies b ON b.post_id = p.id WHERE p.thread_id = ?1 AND p.position BETWEEN ?2 AND ?3 AND (p.state = 'visible' OR (p.state = 'moderated' AND (?4 = 1 OR p.user_id = ?6)) OR (p.state = 'deleted' AND ?5 = 1)) ORDER BY p.position`,
  postBeyond:
    "SELECT id FROM posts WHERE thread_id = ?1 AND position > ?2 AND (state = 'visible' OR (state = 'moderated' AND (?3 = 1 OR user_id = ?5)) OR (state = 'deleted' AND ?4 = 1)) ORDER BY position LIMIT 1",
  threadDetail: `SELECT ${threadColumns}, EXISTS(SELECT 1 FROM thread_bans WHERE thread_id = t.id AND user_id = ?2 AND (expires_at IS NULL OR expires_at > ?3)) AS thread_banned FROM threads t WHERE t.id = ?1`,
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
  if (!row) throw new NotFoundError();
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
    appendModeratorLog(ctx, actor, "node.create", "node", row.id);
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
    appendModeratorLog(ctx, actor, "node.update", "node", input.nodeId);
  });
  return nodeValues(ctx, actor, [input.nodeId])[0]!;
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
  const { row, node } = requireThread(ctx, actor, input.threadId);
  ctx.views.set(row.id, (ctx.views.get(row.id) ?? 0) + 1);
  return {
    thread: threadValue(ctx, actor, row.id),
    seo: seoForThread(ctx, actor, row.id),
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
      const state = decision.moderated || spam ? "moderated" : "visible";
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
      const state = decision.moderated || spam ? "moderated" : "visible";
      const current = threadRow(ctx, row.id)!;
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
    publishEvent(ctx, { type: "content.edited", targetType: "thread", targetId: row.id });
    if (can(ctx, actor, "forum.editAny", { nodeId: row.node_id }))
      appendModeratorLog(ctx, actor, "thread.update", "thread", row.id);
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
    publishEvent(ctx, { type: "content.edited", targetType: "post", targetId: post.id });
    if (
      can(ctx, actor, "forum.editAny", { nodeId: thread.row.node_id }) &&
      post.user_id === actorUserId(actor)
    )
      appendModeratorLog(ctx, actor, "post.edit", "post", post.id);
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
    publishEvent(ctx, { type: "content.edited", targetType: "thread", targetId: row.id });
    appendModeratorLog(ctx, actor, "thread.sticky", "thread", row.id, "", {
      isSticky: input.isSticky,
    });
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
    publishEvent(ctx, { type: "content.edited", targetType: "thread", targetId: row.id });
    appendModeratorLog(ctx, actor, "thread.lock", "thread", row.id, "", {
      isLocked: input.isLocked,
    });
  });
  return threadValue(ctx, actor, row.id);
});
export const threadsMoveOp = implement(contracts.threadsMove, (ctx, actor, input) => {
  requireAuthenticated(actor);
  const { row } = requireThread(ctx, actor, input.threadId);
  requirePermission(ctx, actor, "forum.move", { nodeId: row.node_id });
  const target = requireNode(ctx, actor, input.nodeId);
  requirePermission(ctx, actor, "forum.move", { nodeId: input.nodeId });
  if (target.node.type !== "forum")
    throw new ValidationError("Threads can only be moved to forums.");
  writeTx(ctx, () => {
    const current = threadRow(ctx, row.id)!;
    if (current.node_id === input.nodeId) {
      appendModeratorLog(ctx, actor, "thread.move", "thread", row.id, "", {
        nodeId: input.nodeId,
        changed: false,
      });
      return;
    }
    forumDb(ctx).prepare("UPDATE threads SET node_id = ?1 WHERE id = ?2").run(input.nodeId, row.id);
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
    publishEvent(ctx, { type: "content.edited", targetType: "thread", targetId: row.id });
    appendModeratorLog(ctx, actor, "thread.move", "thread", row.id, "", { nodeId: input.nodeId });
  });
  return threadValue(ctx, actor, row.id);
});
export const threadsDeleteOp = implement(contracts.threadsDelete, (ctx, actor, input) => {
  requireAuthenticated(actor);
  const { row } = requireThread(ctx, actor, input.threadId);
  requirePermission(ctx, actor, "forum.deleteAny", { nodeId: row.node_id });
  writeTx(ctx, () => {
    if (changeThreadState(ctx, row.id, "deleted"))
      publishEvent(ctx, {
        type: "content.deleted",
        targetType: "thread",
        targetId: row.id,
        payload: { previousState: row.state },
      });
    appendModeratorLog(ctx, actor, "thread.delete", "thread", row.id);
  });
  return threadValue(ctx, actor, row.id);
});
export const threadsRestoreOp = implement(contracts.threadsRestore, (ctx, actor, input) => {
  requireAuthenticated(actor);
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
    if (changeThreadState(ctx, row.id, "visible"))
      publishEvent(ctx, { type: "content.state_changed", targetType: "thread", targetId: row.id });
    appendModeratorLog(ctx, actor, "thread.restore", "thread", row.id);
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
        payload: { previousState: post.state },
      });
    if (can(ctx, actor, "forum.deleteAny", { nodeId: thread.row.node_id }))
      appendModeratorLog(ctx, actor, "post.delete", "post", post.id);
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
      publishEvent(ctx, { type: "content.state_changed", targetType: "post", targetId: post.id });
    appendModeratorLog(ctx, actor, "post.restore", "post", post.id);
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

export const operations = [
  nodesListOp,
  nodesGetOp,
  nodesCreateOp,
  nodesUpdateOp,
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
  postsListOp,
  postsGetOp,
  postsCreateOp,
  postsUpdateOp,
  postsDeleteOp,
  postsRestoreOp,
];
