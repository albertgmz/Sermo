import type { SQLQueryBindings } from "bun:sqlite";
import * as z from "zod";
import type { Actor } from "../../actor";
import { actorUserId, requireAuthenticated } from "../../actor";
import { type Ctx, invalidate, prepared } from "../../context";
import * as contracts from "../../contracts/forums";
import { writeTx } from "../../db/tx";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  SermoError,
  UnauthenticatedError,
  ValidationError,
} from "../../errors";
import { publishEvent } from "../../events";
import { implement, markPublic } from "../../operation";
import { decodeCursor, encodeCursor } from "../../pagination";
import {
  can,
  currentActor,
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
import { bbCodeText, storeContentReferences, storeSpoilers } from "../../render";
import { loadViewerReactions, reactionSummary } from "../../shared/reactions";
import { loadUserSummaries } from "../../shared/users";
import { iso, isoOrNull } from "../../time";
import { requireNotErased } from "../admin/erased";
import { confirmActorPassword } from "../admin/shared";
import { loadAttachments, setAttachments, validateEmbeddedAttachments } from "../attachments";
import { completeRunningJob, enqueueJob, registerJobHandler } from "../jobs";
import { requireSiteView } from "../members/site-access";
import {
  appendModeratorLog,
  moderateEditedContent,
  prepareModeratedContent,
  recordPostRevision,
  renderModeratedContent,
  requireWriteRoom,
  withSpamCheck,
} from "../moderation";
import { requireTermsAccepted } from "../pages/acceptance";
import { assertRemovalNotBegun, PURGE_CHUNK, purgeContent, purgeThread } from "../purge/purge";
import { isBotAgent } from "../security/device";
import { logIp } from "../security/log";
import { seoForNode, seoForThread } from "../seo";
import { excerptFromMarkdown } from "../seo/excerpt";
import { resolvedFileUrl } from "../storage/url";
import { addFeature, endStaffFeature, featureKinds } from "./features";
import { forumPrefixOperations, requireActivePrefix } from "./prefixes";
import { nodeTabs, threadPresenter } from "./presentation";
import { type ReadGates, readGates } from "./read-gates";

export { type ReadGates, readGates } from "./read-gates";

type State = "visible" | "moderated" | "deleted";
export type ThreadRow = {
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
  excerpt: string;
  prefix_id: number | null;
  cover_id: number | null;
  highlighted_until: number | null;
  bumped_at: number | null;
  sort_at: number;
  thread_banned?: number;
  transfer_role?: string | null;
  transfer_failed_at?: number | null;
};
export type PostRow = {
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
  icon_key: string | null;
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
export const threadColumns =
  "id, node_id, user_id, title, state, is_sticky, is_locked, created_at, reply_count, view_count, first_post_id, last_post_at, last_post_id, last_poster_id, merged_into_id, excerpt, prefix_id, cover_id, highlighted_until, bumped_at, sort_at";
const threadDetailColumns = threadColumns
  .split(", ")
  .map((column) => `t.${column}`)
  .join(", ");
/** A merge stores position p as -(p + 1) while it renumbers; reads return the real position. */
const storedPosition = (column: string) =>
  `CASE WHEN ${column} < 0 THEN -${column} - 1 ELSE ${column} END`;
/** What the viewer may see of a post: the parameters hold view-moderated, view-deleted and the viewer. */
const postVisibleBy = (moderated: number, deleted: number, viewer: number) =>
  `(p.state = 'visible' OR (p.state = 'moderated' AND (?${moderated} = 1 OR p.user_id = ?${viewer})) OR (p.state = 'deleted' AND ?${deleted} = 1))`;
const postVisible = postVisibleBy(4, 5, 6);
const postColumns = `p.id, p.thread_id, p.user_id, ${storedPosition("p.position")} AS position, p.state, p.created_at, p.edited_at, p.reaction_counts, p.attachment_count`;
const nodeColumns =
  "id, icon_file_id, icon_key, cover_file_id, thread_count, post_count, last_post_at, last_post_id, last_thread_id, last_thread_title, last_poster_id, require_thread_approval, require_reply_approval, is_read_only, min_account_age_days, min_post_count";
/** SQL shared by the hot paths and their query-plan tests. */
export const forumSql = {
  sticky: `SELECT ${threadColumns} FROM threads WHERE node_id = ?1 AND is_sticky = 1 AND merged_into_id IS NULL AND (state = 'visible' OR (state = 'moderated' AND (?2 = 1 OR user_id = ?4)) OR (state = 'deleted' AND ?3 = 1)) ORDER BY sort_at DESC, id DESC`,
  stickyByPrefix: `SELECT ${threadColumns} FROM threads WHERE node_id = ?1 AND is_sticky = 1 AND prefix_id = ?5 AND merged_into_id IS NULL AND (state = 'visible' OR (state = 'moderated' AND (?2 = 1 OR user_id = ?4)) OR (state = 'deleted' AND ?3 = 1)) ORDER BY sort_at DESC, id DESC`,
  threadPage: `SELECT ${threadColumns} FROM threads WHERE node_id = ?1 AND is_sticky = 0 AND merged_into_id IS NULL AND (state = 'visible' OR (state = 'moderated' AND (?2 = 1 OR user_id = ?7)) OR (state = 'deleted' AND ?3 = 1)) AND (sort_at, id) < (?4, ?5) ORDER BY sort_at DESC, id DESC LIMIT ?6`,
  threadPageByPrefix: `SELECT ${threadColumns} FROM threads WHERE node_id = ?1 AND is_sticky = 0 AND prefix_id = ?8 AND merged_into_id IS NULL AND (state = 'visible' OR (state = 'moderated' AND (?2 = 1 OR user_id = ?7)) OR (state = 'deleted' AND ?3 = 1)) AND (sort_at, id) < (?4, ?5) ORDER BY sort_at DESC, id DESC LIMIT ?6`,
  postPage: `SELECT ${postColumns}, b.body_html FROM posts p JOIN post_bodies b ON b.post_id = p.id WHERE p.thread_id = ?1 AND p.position BETWEEN ?2 AND ?3 AND (p.state = 'visible' OR (p.state = 'moderated' AND (?4 = 1 OR p.user_id = ?6)) OR (p.state = 'deleted' AND ?5 = 1)) ORDER BY p.position`,
  // A merge's target while its posts are renumbered: positions are stored as -(p + 1) or as p.
  decodedPostPage: `SELECT ${postColumns}, b.body_html FROM posts p JOIN post_bodies b ON b.post_id = p.id WHERE p.thread_id = ?1 AND (p.position BETWEEN ?2 AND ?3 OR p.position BETWEEN -?3 - 1 AND -?2 - 1) AND ${postVisible} ORDER BY ${storedPosition("p.position")}`,
  /** The post a poller holds at a position, if the viewer may see it: ?3 view-moderated, ?4 view-deleted, ?5 viewer. */
  postAt: `SELECT p.id FROM posts p WHERE p.thread_id = ?1 AND p.position = ?2 AND ${postVisibleBy(3, 4, 5)}`,
  decodedPostAt: `SELECT p.id FROM posts p WHERE p.thread_id = ?1 AND p.position IN (?2, -?2 - 1) AND ${postVisibleBy(3, 4, 5)}`,
  decodedPostBeyond: `SELECT p.id FROM posts p WHERE p.thread_id = ?1 AND (p.position > ?3 OR p.position < -?3 - 1) AND ${postVisible} LIMIT 1`,
  postBeyond:
    "SELECT id FROM posts WHERE thread_id = ?1 AND position > ?2 AND (state = 'visible' OR (state = 'moderated' AND (?3 = 1 OR user_id = ?5)) OR (state = 'deleted' AND ?4 = 1)) ORDER BY position LIMIT 1",
  threadDetail: `SELECT ${threadDetailColumns}, x.role AS transfer_role, x.failed_at AS transfer_failed_at, EXISTS(SELECT 1 FROM thread_bans WHERE thread_id = t.id AND user_id = ?2 AND (expires_at IS NULL OR expires_at > ?3)) AS thread_banned FROM threads t LEFT JOIN thread_transfers x ON x.thread_id = t.id WHERE t.id = ?1`,
  threadBansAmong:
    "SELECT thread_id FROM thread_bans WHERE user_id = ?1 AND thread_id IN (SELECT value FROM json_each(?2)) AND (expires_at IS NULL OR expires_at > ?3)",
  /**
   * The newest lock or unlock of a thread, by the single tool or the bulk one: who did it, and
   * whether it locked (index seek on the log's target). A bulk entry that changed nothing counts
   * for nothing.
   */
  newestLock:
    "SELECT actor_id, CASE action WHEN 'bulk.lock' THEN 1 WHEN 'bulk.unlock' THEN 0 ELSE json_extract(details, '$.isLocked') END AS locked FROM moderator_log WHERE target_type = 'thread' AND target_id = ?1 AND action IN ('thread.lock', 'bulk.lock', 'bulk.unlock') AND coalesce(json_extract(details, '$.changed'), 1) != 0 ORDER BY id DESC LIMIT 1",
  threadsByIds: `SELECT ${threadColumns} FROM threads WHERE id IN (SELECT value FROM json_each(?1))`,
  postsByIds: `SELECT ${postColumns}, b.body_html FROM posts p JOIN post_bodies b ON b.post_id = p.id WHERE p.id IN (SELECT value FROM json_each(?1))`,
  maxPostPosition: "SELECT position FROM posts WHERE thread_id = ?1 ORDER BY position DESC LIMIT 1",
  lastPostPositions: `SELECT id, ${storedPosition("position")} AS position FROM posts WHERE id IN (SELECT value FROM json_each(?1))`,
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
  // Unread state uses post ids: reading a post clears notices for it and every older post.
  clearThreadNotices:
    "UPDATE notifications INDEXED BY notifications_user_thread SET read_at = ?1 WHERE user_id = ?2 AND thread_id = ?3 AND epoch = (SELECT notification_epoch FROM users WHERE id = ?2) AND read_at IS NULL AND type IN ('thread.watched', 'node.thread', 'node.post', 'content.quoted', 'content.mentioned', 'member.thread') AND (content_type = 'thread' OR (content_type = 'post' AND content_id <= ?4))",
} as const;
/**
 * The same listing statements for a viewer who may open only their own threads in the forum:
 * the author comes first, through the index on authors, then the forum.
 */
const ownOnly = (sql: string, viewer: number) =>
  sql.replace(
    "FROM threads WHERE node_id = ?1",
    `FROM threads INDEXED BY threads_user_id WHERE user_id = ?${viewer} AND node_id = ?1`,
  );
export const ownThreadSql = {
  sticky: ownOnly(forumSql.sticky, 4),
  stickyByPrefix: ownOnly(forumSql.stickyByPrefix, 4),
  threadPage: ownOnly(forumSql.threadPage, 7),
  threadPageByPrefix: ownOnly(forumSql.threadPageByPrefix, 7),
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
/** Inside a write transaction: the forum a thread is in as committed now, tombstones of merges included. */
function committedNodeId(ctx: Ctx, threadId: number): number {
  const row = threadRow(ctx, threadId);
  if (!row) throw new NotFoundError();
  return row.node_id;
}
/** Inside a write transaction: the split permission, as the moderator holds it now, on the source and the new forum. */
function requireCurrentSplitter(ctx: Ctx, actor: Actor, sourceId: number, nodeId: number): void {
  const moderator = currentActor(ctx, actor);
  const source = requireThread(ctx, moderator, sourceId).row;
  requirePermission(ctx, moderator, "forum.split", { nodeId: source.node_id });
  requirePermission(ctx, moderator, "node.view", { nodeId }, { notFound: true });
  requirePermission(ctx, moderator, "forum.split", { nodeId });
}
/** Inside a write transaction: the merge permission, as the moderator holds it now, on every thread's forum. */
function requireCurrentMerger(ctx: Ctx, actor: Actor, threadIds: number[]): void {
  const moderator = currentActor(ctx, actor);
  for (const id of threadIds) {
    const nodeId = committedNodeId(ctx, id);
    requirePermission(ctx, moderator, "node.view", { nodeId }, { notFound: true });
    requirePermission(ctx, moderator, "forum.merge", { nodeId });
  }
}
/**
 * Inside a write transaction: restoring needs the permission that matches the state the content
 * is in now, or either one for visible content. The request's actor was resolved before the
 * transaction opened.
 */
function requireRestorer(ctx: Ctx, actor: Actor, state: State, nodeId: number): void {
  if (state === "moderated") requirePermission(ctx, actor, "forum.approve", { nodeId });
  else if (state === "deleted") requirePermission(ctx, actor, "forum.undelete", { nodeId });
  else if (
    !can(ctx, actor, "forum.undelete", { nodeId }) &&
    !can(ctx, actor, "forum.approve", { nodeId })
  )
    throw new ForbiddenError();
}
/**
 * Why the forum's own posting rules (read-only, minimum account age, minimum post count) stop
 * the actor, or null when they do not: the one decision behind the check a write makes and the
 * `canReply` a read answers.
 */
function postingRuleRefusal(ctx: Ctx, actor: Actor, settings: NodeRow): SermoError | null {
  if (can(ctx, actor, "forum.bypassNodeRules", { nodeId: settings.id })) return null;
  if (settings.is_read_only) return new ForbiddenError("This forum is read-only.");
  if (actor.kind === "guest") return new UnauthenticatedError();
  const member = actor;
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
    return new ForbiddenError("Your account is too new to post in this forum.");
  if (settings.min_post_count && (!principal || principal.postCount < settings.min_post_count))
    return new ForbiddenError("You need more posts before posting in this forum.");
  return null;
}
function checkNodePostingRules(ctx: Ctx, actor: Actor, nodeId: number): NodeRow {
  const settings = nodeRows(ctx, nodeId).get(nodeId);
  if (!settings) throw new NotFoundError();
  const refusal = postingRuleRefusal(ctx, actor, settings);
  if (refusal) throw refusal;
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
/**
 * The one rule for content in a given state, once the forum is open to the viewer: visible
 * content needs nothing more, moderated content its author or forum.viewModerated there, deleted
 * content forum.viewDeleted there. `check` answers a permission for a forum.
 */
function mayViewState(
  check: (permission: "forum.viewModerated" | "forum.viewDeleted", nodeId: number) => boolean,
  viewerId: number | null,
  state: State,
  ownerId: number,
  nodeId: number,
): boolean {
  if (state === "visible") return true;
  if (state === "moderated") return ownerId === viewerId || check("forum.viewModerated", nodeId);
  return check("forum.viewDeleted", nodeId);
}
/**
 * Whether content of a state, owned by a member, in a forum, is shown to the viewer. `gates` are
 * the viewer's read gates: they decide whether a thread other members started may be opened
 * (`threadReadable`) and whether a post's text may be read (`postReadable`).
 */
export type ContentRule = ((nodeId: number, state: State, ownerId: number) => boolean) & {
  readonly gates: ReadGates;
};
/**
 * The rule of the per-forum listing as one function for a viewer, resolving their permissions
 * once: the forum must be open (`canOpen`, by default node.view there), then the state rule.
 * A page of items passes the set of forums it already holds.
 */
export const contentRule = markPublic(
  "The rule itself decides per forum with node.view, forum.viewModerated, forum.viewDeleted, forum.viewOthers and forum.viewContent.",
  function contentRule(ctx: Ctx, actor: Actor, canOpen?: (nodeId: number) => boolean): ContentRule {
    const permissions = permissionsOf(ctx, actor);
    const viewerId = actorUserId(actor);
    const open = canOpen ?? ((nodeId: number) => permissions.can("node.view", { nodeId }));
    const rule = (nodeId: number, state: State, ownerId: number) =>
      open(nodeId) &&
      mayViewState(
        (permission, node) => permissions.can(permission, { nodeId: node }),
        viewerId,
        state,
        ownerId,
        nodeId,
      );
    return Object.assign(rule, { gates: readGates(ctx, actor) });
  },
);
/**
 * A thread that was not merged away, in an open forum, in a state the viewer may see, that the
 * viewer started or may open (`forum.viewOthers`).
 */
export function threadReadable(rule: ContentRule, thread: ThreadRow): boolean {
  return (
    thread.merged_into_id === null &&
    rule(thread.node_id, thread.state, thread.user_id) &&
    rule.gates.opens(thread.node_id, thread.user_id)
  );
}
/** A post in a state the viewer may see, in a thread they may open: its existence, not its text. */
export function postOpen(
  rule: ContentRule,
  thread: ThreadRow,
  post: { state: State; user_id: number },
): boolean {
  return threadReadable(rule, thread) && rule(thread.node_id, post.state, post.user_id);
}
/** A post whose text the viewer may read: a post they may see, in a forum whose content is open to them. */
export function postReadable(
  rule: ContentRule,
  thread: ThreadRow,
  post: { state: State; user_id: number },
): boolean {
  return postOpen(rule, thread, post) && rule.gates.reads(thread.node_id, post.user_id);
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
  // The forum is open to the caller; the rest is the shared rule.
  if (
    !threadReadable(
      contentRule(ctx, actor, () => true),
      row,
    )
  )
    throw new NotFoundError();
  return { row, node };
}
export function requirePost(ctx: Ctx, actor: Actor, id: number, withBody = false) {
  const post = postRow(ctx, id, withBody);
  if (!post) throw new NotFoundError();
  const thread = requireThread(ctx, actor, post.thread_id);
  const rule = contentRule(ctx, actor, () => true);
  if (!postOpen(rule, thread.row, post)) throw new NotFoundError();
  // The thread is known to the viewer, so its text being closed to them is not a secret.
  if (!rule.gates.reads(thread.row.node_id, post.user_id)) throw new ForbiddenError(CONTENT_CLOSED);
  return { post, thread };
}
const CONTENT_CLOSED = "The posts of this forum are not open to you.";
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
/**
 * Hiding a thread: whoever may delete any, or its author where they may hide their own threads
 * and the thread is not locked.
 */
function mayDeleteThread(
  permissions: ReturnType<typeof permissionsOf>,
  row: Pick<ThreadRow, "node_id" | "user_id" | "is_locked">,
): boolean {
  return (
    permissions.can("forum.deleteAny", { nodeId: row.node_id }) ||
    (!row.is_locked &&
      permissions.can("forum.deleteOwnThread", { nodeId: row.node_id, ownerId: row.user_id }))
  );
}
/**
 * Whether `posts.create` takes a reply to the thread from the viewer, before it looks at the
 * reply itself: `threads.get` and the feed answer with it. `settings` is the thread's forum.
 */
function mayReply(
  ctx: Ctx,
  actor: Actor,
  permissions: ReturnType<typeof permissionsOf>,
  row: Pick<ThreadRow, "node_id" | "is_locked">,
  threadBanned: boolean,
  settings: NodeRow | undefined,
): boolean {
  return (
    permissions.can("forum.reply", { nodeId: row.node_id, threadBanned }) &&
    permissions.can("forum.viewContent", { nodeId: row.node_id }) &&
    (!row.is_locked || permissions.can("forum.replyLocked", { nodeId: row.node_id })) &&
    settings !== undefined &&
    postingRuleRefusal(ctx, actor, settings) === null
  );
}
/**
 * The threads, among `rows`, the viewer may reply in: the viewer's thread bans and the forums'
 * posting rules are each read once for the whole page. Callers pass threads the viewer may open.
 */
export function repliableThreads(ctx: Ctx, actor: Actor, rows: ThreadRow[]): Set<number> {
  const userId = actorUserId(actor);
  const banned = new Set(
    userId === null || rows.length === 0
      ? []
      : statement<{ thread_id: number }, [number, string, number]>(
          ctx,
          "threadBansAmong",
          forumSql.threadBansAmong,
        )
          .all(userId, JSON.stringify(rows.map((row) => row.id)), ctx.now())
          .map((ban) => ban.thread_id),
  );
  const permissions = permissionsOf(ctx, actor);
  const nodeIds = new Set(rows.map((row) => row.node_id));
  const settings =
    nodeIds.size === 0
      ? new Map<number, NodeRow>()
      : nodeRows(ctx, nodeIds.size === 1 ? rows[0]!.node_id : undefined);
  return new Set(
    rows
      .filter((row) =>
        mayReply(ctx, actor, permissions, row, banned.has(row.id), settings.get(row.node_id)),
      )
      .map((row) => row.id),
  );
}
/** Removing a thread's cover: the author of a visible thread, or whoever may edit others' threads. */
function mayRemoveCover(ctx: Ctx, actor: Actor, row: ThreadRow): boolean {
  return (
    can(ctx, actor, "forum.editAny", { nodeId: row.node_id }) ||
    (row.user_id === actorUserId(actor) && row.state === "visible")
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
  const present = threadPresenter(ctx);
  const gates = readGates(ctx, actor);
  return rows.map((row) => {
    const read = reads.get(row.id);
    return {
      id: row.id,
      nodeId: row.node_id,
      node: present.node(row.node_id),
      title: row.title,
      prefix: present.prefix(row.prefix_id),
      // Where only titles are open to the viewer, the start of the opening post is not.
      excerpt: gates.reads(row.node_id, row.user_id) ? row.excerpt : "",
      cover: gates.reads(row.node_id, row.user_id) ? present.cover(row.cover_id) : null,
      highlightedUntil: isoOrNull(row.highlighted_until),
      bumpedAt: isoOrNull(row.bumped_at),
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
  return postValuesMixed(
    ctx,
    actor,
    rows.map((row) => ({ row, locked, nodeId, firstPostId })),
    detail,
  );
}
/** Posts of different threads on one page: authors, reactions and attachments load once. */
export function postValuesMixed(
  ctx: Ctx,
  actor: Actor,
  entries: { row: PostRow; locked: number; nodeId: number; firstPostId: number }[],
  detail = false,
) {
  const rows = entries.map((entry) => entry.row);
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
  const withAttachments = entries.filter((entry) =>
    permissions.can("forum.viewAttachments", { nodeId: entry.nodeId }),
  );
  const attachments = withAttachments.length
    ? loadAttachments(
        ctx,
        "post",
        withAttachments.map((entry) => entry.row.id),
      )
    : new Map();
  return entries.map(({ row, locked, nodeId, firstPostId }) => ({
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
    canHardDelete:
      row.id !== firstPostId &&
      (row.state === "deleted"
        ? permissions.can("forum.hardDelete", { nodeId })
        : !locked && permissions.can("forum.hardDeleteOwn", { nodeId, ownerId: row.user_id })),
    canReport: permissions.can("report.create"),
    ...(detail ? { bodySource: row.body_source } : {}),
  }));
}
/** The threads with these ids (any state), for pages that mix threads. */
export function threadRowsByIds(ctx: Ctx, ids: number[]): ThreadRow[] {
  if (ids.length === 0) return [];
  return statement<ThreadRow, [string]>(ctx, "threadsByIds", forumSql.threadsByIds).all(
    JSON.stringify(ids),
  );
}
/** The posts with these ids and their rendered bodies, for pages that mix threads. */
export function postRowsByIds(ctx: Ctx, ids: number[]): PostRow[] {
  if (ids.length === 0) return [];
  return statement<PostRow, [string]>(ctx, "postsByIds", forumSql.postsByIds).all(
    JSON.stringify(ids),
  );
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
  const tabs = nodeTabs(ctx);
  const rows = nodeRows(ctx, ids.length === 1 ? ids[0] : undefined);
  const users = loadUserSummaries(
    ctx,
    [...rows.values()].flatMap((r) => (r.last_poster_id == null ? [] : [r.last_poster_id])),
  );
  const permissions = permissionsOf(ctx, actor);
  const gates = readGates(ctx, actor);
  return ids.map((id) => {
    const entry = tree.get(id)!;
    const row = rows.get(id)!;
    // The newest post is some member's thread: not shown where others' threads are closed.
    const lastPost =
      row.last_post_id == null || !gates.opensOthers(id)
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
      tabId: tabs.get(id) ?? null,
      icon:
        row.icon_file_id === null
          ? null
          : { fileId: row.icon_file_id, url: resolvedFileUrl(ctx, row.icon_file_id, true) },
      iconKey: row.icon_key,
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
/** Thread shapes for rows a caller already filtered to what the viewer may open. */
export const threadValuesFor = markPublic(
  "Callers decide which threads the viewer may open; this only builds their shape.",
  function threadValuesFor(ctx: Ctx, actor: Actor, rows: ThreadRow[]) {
    return threadValues(ctx, actor, rows);
  },
);
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
  requireSiteView(ctx, actor);
  return {
    items: nodeValues(ctx, actor, viewableNodeIds(ctx, actor)),
  };
});
export const nodesGetOp = implement(contracts.nodesGet, (ctx, actor, input) => {
  const { node } = requireNode(ctx, actor, input.nodeId);
  // After the forum check: whoever may not see it, a banned member included, is told only that
  // it is not found.
  requireSiteView(ctx, actor);
  const userId = actorUserId(actor);
  // Only forums can be watched: a category needs no lookup.
  const watch =
    userId === null || node.type !== "forum"
      ? undefined
      : statement<{ mode: "threads" | "posts"; email: number }, [number, number]>(
          ctx,
          "nodeWatching",
          "SELECT mode, email FROM node_watches WHERE node_id = ?1 AND user_id = ?2",
        ).get(input.nodeId, userId);
  return {
    node: nodeValues(ctx, actor, [input.nodeId])[0]!,
    watching: watch ? { mode: watch.mode, email: !!watch.email } : null,
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
/** A tab may be set only on a root category, and must exist. */
function requireTabFor(
  ctx: Ctx,
  tabId: number | null | undefined,
  parentId: number | null,
  type: "category" | "forum",
): void {
  if (tabId == null) return;
  if (parentId !== null || type !== "category")
    throw new ValidationError("Only a root category can belong to a forum tab.");
  if (!forumDb(ctx).prepare("SELECT 1 FROM forum_tabs WHERE id = ?1").get(tabId))
    throw new ValidationError("That forum tab does not exist.");
}
export const nodesCreateOp = implement(contracts.nodesCreate, (ctx, actor, input) => {
  requireAuthenticated(actor);
  requirePermission(ctx, actor, "admin.nodes");
  const id = writeTx(ctx, () => {
    if (input.parentId != null && !getNodeTree(ctx).get(input.parentId)) throw new NotFoundError();
    requireTabFor(ctx, input.tabId, input.parentId, input.type);
    const row = forumDb(ctx)
      .prepare<
        { id: number },
        [number | null, string, string, string, number, number, number | null, string | null]
      >(
        "INSERT INTO nodes (parent_id, type, title, description, position, content_updated_at, tab_id, icon_key) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) RETURNING id",
      )
      .get(
        input.parentId,
        input.type,
        input.title,
        input.description,
        input.position,
        ctx.now(),
        input.tabId ?? null,
        input.iconKey ?? null,
      )!;
    writeNodeSettings(ctx, row.id, input.settings);
    invalidate(ctx, "node_tree");
    invalidate(ctx, "node_tabs");
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
    const parentId = input.parentId === undefined ? current.parentId : input.parentId;
    requireTabFor(ctx, input.tabId, parentId, current.type);
    const stored = forumDb(ctx)
      .prepare<{ tab_id: number | null; icon_key: string | null }, [number]>(
        "SELECT tab_id, icon_key FROM nodes WHERE id = ?1",
      )
      .get(input.nodeId)!;
    const currentTab = stored.tab_id;
    // A category moved under another node leaves the tabs: only root categories belong to one.
    const tabId = parentId !== null ? null : input.tabId === undefined ? currentTab : input.tabId;
    forumDb(ctx)
      .prepare(
        "UPDATE nodes SET parent_id = ?1, title = ?2, description = ?3, position = ?4, content_updated_at = ?6, tab_id = ?7, icon_key = ?8 WHERE id = ?5",
      )
      .run(
        parentId,
        input.title ?? current.title,
        input.description ?? current.description,
        input.position ?? current.position,
        input.nodeId,
        ctx.now(),
        tabId,
        input.iconKey === undefined ? stored.icon_key : input.iconKey,
      );
    writeNodeSettings(ctx, input.nodeId, input.settings);
    invalidate(ctx, "node_tree");
    invalidate(ctx, "node_tabs");
    publishEvent(ctx, { type: "content.edited", targetType: "node", targetId: input.nodeId });
    appendModeratorLog(ctx, actor, "node.update", "node", input.nodeId, "", {}, input.nodeId);
  });
  return nodeValues(ctx, actor, [input.nodeId])[0]!;
});

export const nodesSetModeratorOp = implement(
  contracts.nodesSetModerator,
  async (ctx, actor, input) => {
    requireAuthenticated(actor);
    requirePermission(ctx, actor, "admin.permissions");
    await confirmActorPassword(ctx, actor, input.actorPassword);
    return writeTx(ctx, () => {
      if (!getNodeTree(ctx).get(input.nodeId)) throw new NotFoundError();
      if (
        !forumDb(ctx)
          .prepare<{ id: number }, [number]>("SELECT id FROM users WHERE id = ?1")
          .get(input.userId)
      )
        throw new NotFoundError();
      requireNotErased(ctx, input.userId);
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
  },
);

export const threadsListOp = implement(contracts.threadsList, (ctx, actor, input) => {
  const { node } = requireNode(ctx, actor, input.nodeId);
  requireSiteView(ctx, actor);
  if (node.type !== "forum") throw new ValidationError("Threads can only be listed in forums.");
  const userId = actorUserId(actor) ?? -1;
  const permissions = permissionsOf(ctx, actor);
  const viewModerated = Number(permissions.can("forum.viewModerated", { nodeId: input.nodeId }));
  const viewDeleted = Number(permissions.can("forum.viewDeleted", { nodeId: input.nodeId }));
  const cursor = input.cursor ? decodeCursor(input.cursor, threadCursor) : null;
  const prefixId = input.prefixId;
  // Where threads of other members are closed to the viewer, only theirs are listed.
  const own = !permissions.can("forum.viewOthers", { nodeId: input.nodeId });
  const sql = own ? ownThreadSql : forumSql;
  const key = (name: string) => (own ? `own.${name}` : name);
  const sticky = cursor
    ? []
    : prefixId === undefined
      ? statement<ThreadRow, [number, number, number, number]>(ctx, key("sticky"), sql.sticky).all(
          input.nodeId,
          viewModerated,
          viewDeleted,
          userId,
        )
      : statement<ThreadRow, [number, number, number, number, number]>(
          ctx,
          key("stickyByPrefix"),
          sql.stickyByPrefix,
        ).all(input.nodeId, viewModerated, viewDeleted, userId, prefixId);
  const pageParams = [
    input.nodeId,
    viewModerated,
    viewDeleted,
    cursor?.[0] ?? Number.MAX_SAFE_INTEGER,
    cursor?.[1] ?? Number.MAX_SAFE_INTEGER,
    input.limit + 1,
    userId,
  ] as const;
  const rows =
    prefixId === undefined
      ? statement<ThreadRow, [number, number, number, number, number, number, number]>(
          ctx,
          key("threadPage"),
          sql.threadPage,
        ).all(...pageParams)
      : statement<ThreadRow, [number, number, number, number, number, number, number, number]>(
          ctx,
          key("threadPageByPrefix"),
          sql.threadPageByPrefix,
        ).all(...pageParams, prefixId);
  const page = rows.slice(0, input.limit);
  const values = threadValues(ctx, actor, [...sticky, ...page]);
  const nextCursor =
    rows.length > input.limit ? encodeCursor([page.at(-1)!.sort_at, page.at(-1)!.id]) : null;
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
  requireSiteView(ctx, actor);
  // Crawlers read threads too: their visits are not views.
  if (input.countView && !isBotAgent(actor.userAgent))
    ctx.views.set(row.id, (ctx.views.get(row.id) ?? 0) + 1);
  const userId = actorUserId(actor);
  return {
    thread: threadValue(ctx, actor, row.id),
    featured: featureKinds(ctx, [row.id], ctx.now()).get(row.id) ?? null,
    seo: { ...seoForThread(ctx, actor, row.id), redirect: targetId !== input.threadId },
    node: { id: node.id, title: node.title },
    watching:
      userId === null
        ? null
        : (() => {
            const watch = statement<{ email: number }, [number, number]>(
              ctx,
              "threadWatching",
              "SELECT email FROM thread_watches WHERE thread_id = ?1 AND user_id = ?2",
            ).get(row.id, userId);
            return watch ? { email: !!watch.email } : null;
          })(),
    permissions: {
      canReply: mayReply(
        ctx,
        actor,
        permissionsOf(ctx, actor),
        row,
        !!row.thread_banned,
        nodeRows(ctx, node.id).get(node.id),
      ),
      canEditTitle: mayEditTitle(ctx, actor, row),
      canModerate: canModerate(ctx, actor, node.id),
      canDelete: row.state !== "deleted" && mayDeleteThread(permissionsOf(ctx, actor), row),
      canLock: mayLockThread(ctx, actor, row, !row.is_locked),
      canHardDelete:
        row.state === "deleted"
          ? can(ctx, actor, "forum.hardDelete", { nodeId: row.node_id })
          : !row.is_locked &&
            can(ctx, actor, "forum.hardDeleteOwn", { nodeId: row.node_id, ownerId: row.user_id }),
      // Reporting targets the first post, and watching needs a visible thread: both are open to
      // a signed-in viewer who got this far; reporting also needs the permission (createReport).
      canReport: can(ctx, actor, "report.create"),
      canRemoveCover: userId !== null && mayRemoveCover(ctx, actor, row),
      canWatch: userId !== null,
    },
    resolvedPermissions: resolvedPermissions(ctx, actor, { nodeId: node.id }),
  };
});

/**
 * Takes up to `limit` posts from streams that are each in their own order, always the oldest
 * head (then the lowest id, then the first stream). The one rule of the order a merge gives its
 * target: the renumbering writes it and `posts.list` predicts it, so both use this.
 */
function mergeInOrder<T extends { id: number; created_at: number }>(
  streams: T[][],
  limit: number,
  take: (post: T) => void,
): number {
  const heads = streams.map(() => 0);
  let count = 0;
  while (count < limit) {
    let best = -1;
    for (let i = 0; i < streams.length; i++) {
      const row = streams[i]![heads[i]!];
      const chosen = best < 0 ? undefined : streams[best]![heads[best]!];
      if (
        row &&
        (!chosen ||
          row.created_at < chosen.created_at ||
          (row.created_at === chosen.created_at && row.id < chosen.id))
      )
        best = i;
    }
    if (best < 0) break;
    take(streams[best]![heads[best]!++]!);
    count++;
  }
  return count;
}
type MergeState = { sourceIds: number[]; streamStarts: number[]; phase?: string };
type MergeRow = {
  id: number;
  thread_id: number;
  position: number;
  created_at: number;
  state: State;
  user_id: number;
};
/**
 * The state of the merge whose target this is: the finalize job's, or, before it exists, the
 * one every move job carries.
 */
function mergeStateOf(ctx: Ctx, targetId: number): MergeState | null {
  const finalize = statement<{ payload: string }, [string]>(
    ctx,
    "mergeFinalizeState",
    "SELECT payload FROM jobs WHERE unique_key = ?1",
  ).get(finalizeJobKey(targetId));
  if (finalize) return JSON.parse(finalize.payload) as MergeState;
  const move = statement<{ payload: string }, [string, string]>(
    ctx,
    "mergeMoveState",
    "SELECT payload FROM jobs WHERE unique_key >= ?1 AND unique_key < ?2 LIMIT 1",
  ).get(`forums.merge.${targetId}.`, `forums.merge.${targetId}/`);
  return move ? (JSON.parse(move.payload) as { finalState: MergeState }).finalState : null;
}
/**
 * The posts of a merge that has not renumbered its target yet, with the position each will end
 * up in. The streams (the target's own posts and each source's, in their provisional order) are
 * merged by creation time, exactly as the renumbering does, so a post's slot is the same before,
 * during and after its renumbering and paging is not disturbed by the chunks running between
 * two requests. Posts that have not moved yet are counted where they will land. Linear in the
 * posts of the target and its sources (about 45 ms per request at 100,000 posts); only merge
 * targets before the flip step pay it.
 */
function mergeSlots(ctx: Ctx, targetId: number, state: MergeState) {
  const rows = statement<MergeRow, [string]>(
    ctx,
    "mergeUniverse",
    "SELECT id, thread_id, position, created_at, state, user_id FROM posts WHERE thread_id IN (SELECT value FROM json_each(?1))",
  ).all(JSON.stringify([targetId, ...state.sourceIds]));
  const slots = new Map<number, number>();
  const streams: { row: MergeRow; at: number }[][] = state.streamStarts.map(() => []);
  let next = 1;
  for (const row of rows) {
    if (row.thread_id === targetId && row.position <= 0) {
      // The first post, or one already renumbered (stored as -(p + 1)).
      const slot = row.position < 0 ? -row.position - 1 : 0;
      slots.set(row.id, slot);
      next = Math.max(next, slot + 1);
      continue;
    }
    const source = state.sourceIds.indexOf(row.thread_id);
    const at = row.position + (source < 0 ? 0 : state.streamStarts[source + 1]!);
    let stream = 0;
    while (stream + 1 < state.streamStarts.length && state.streamStarts[stream + 1]! <= at)
      stream++;
    streams[stream]!.push({ row, at });
  }
  mergeInOrder(
    streams.map((stream) => stream.sort((a, b) => a.at - b.at).map((item) => item.row)),
    Infinity,
    (row) => slots.set(row.id, next++),
  );
  return { rows, slots };
}

/** One snapshot of a page of the target of a merge in progress, and whether posts follow it. */
function mergingPostPage(
  ctx: Ctx,
  threadId: number,
  start: number,
  end: number,
  [viewModerated, viewDeleted, viewer]: [number, number, number],
  anchorAt?: number,
) {
  return ctx.db.transaction(
    () => {
      const state = mergeStateOf(ctx, threadId);
      if (!state || state.phase !== undefined)
        return {
          anchor:
            anchorAt === undefined
              ? undefined
              : (statement<{ id: number }, [number, number, number, number, number]>(
                  ctx,
                  "decodedPostAt",
                  forumSql.decodedPostAt,
                ).get(threadId, anchorAt, viewModerated, viewDeleted, viewer)?.id ?? null),
          rows: statement<PostRow, [number, number, number, number, number, number]>(
            ctx,
            "decodedPostPage",
            forumSql.decodedPostPage,
          ).all(threadId, start, end, viewModerated, viewDeleted, viewer),
          beyond: statement<{ id: number }, [number, number, number, number, number, number]>(
            ctx,
            "decodedPostBeyond",
            forumSql.decodedPostBeyond,
          ).get(threadId, start, end, viewModerated, viewDeleted, viewer),
        };
      const { rows, slots } = mergeSlots(ctx, threadId, state);
      const shown = rows
        .filter(
          (row) =>
            row.state === "visible" ||
            (row.state === "moderated" && (viewModerated === 1 || row.user_id === viewer)) ||
            (row.state === "deleted" && viewDeleted === 1),
        )
        .map((row) => ({ id: row.id, slot: slots.get(row.id)! }));
      const page = shown
        .filter((row) => row.slot >= start && row.slot <= end)
        .sort((a, b) => a.slot - b.slot);
      const byId = new Map(
        statement<PostRow, [string]>(ctx, "mergePageRows", forumSql.postsByIds)
          .all(JSON.stringify(page.map((row) => row.id)))
          .map((row) => [row.id, row]),
      );
      return {
        anchor:
          anchorAt === undefined
            ? undefined
            : (shown.find((row) => row.slot === anchorAt)?.id ?? null),
        rows: page.map((entry) => ({ ...byId.get(entry.id)!, position: entry.slot })),
        beyond: shown.some((row) => row.slot > end) ? { id: 0 } : undefined,
      };
    },
    { behavior: "deferred" },
  );
}
export const postsListOp = implement(contracts.postsList, (ctx, actor, input) => {
  const { row } = requireThread(ctx, actor, input.threadId);
  requireSiteView(ctx, actor);
  if (!readGates(ctx, actor).readsOthers(row.node_id)) throw new ForbiddenError(CONTENT_CLOSED);
  const permissions = permissionsOf(ctx, actor);
  const viewModerated = Number(permissions.can("forum.viewModerated", { nodeId: row.node_id }));
  const viewDeleted = Number(permissions.can("forum.viewDeleted", { nodeId: row.node_id }));
  const cursor = input.cursor ? decodeCursor(input.cursor, postCursor) : null;
  const start =
    cursor?.[0] ??
    (input.afterPosition === undefined
      ? ((input.page ?? 1) - 1) * input.limit
      : input.afterPosition + 1);
  const end = start + input.limit - 1;
  const viewer = actorUserId(actor) ?? -1;
  const anchorAt = input.afterPosition;
  const { rows, beyond, anchor } =
    row.transfer_role === "merge_target"
      ? mergingPostPage(
          ctx,
          input.threadId,
          start,
          end,
          [viewModerated, viewDeleted, viewer],
          anchorAt,
        )
      : {
          anchor:
            anchorAt === undefined
              ? undefined
              : (statement<{ id: number }, [number, number, number, number, number]>(
                  ctx,
                  "postAt",
                  forumSql.postAt,
                ).get(input.threadId, anchorAt, viewModerated, viewDeleted, viewer)?.id ?? null),
          rows: statement<PostRow, [number, number, number, number, number, number]>(
            ctx,
            "postPage",
            forumSql.postPage,
          ).all(input.threadId, start, end, viewModerated, viewDeleted, viewer),
          beyond: statement<{ id: number }, [number, number, number, number, number]>(
            ctx,
            "postBeyond",
            forumSql.postBeyond,
          ).get(input.threadId, end, viewModerated, viewDeleted, viewer),
        };
  return {
    items: postValues(ctx, actor, rows, row.is_locked, row.node_id, row.first_post_id),
    nextCursor: beyond ? encodeCursor([end + 1]) : null,
    ...(anchor === undefined ? {} : { afterPostId: anchor }),
  };
});
export const postsGetOp = implement(contracts.postsGet, (ctx, actor, input) => {
  const { post, thread } = requirePost(ctx, actor, input.postId, true);
  requireSiteView(ctx, actor);
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
  ): { authorId: number; isVisible: boolean; nodeId: number } {
    const { post, thread } = requirePost(ctx, actor, postId);
    return {
      authorId: post.user_id,
      nodeId: thread.row.node_id,
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
  requireTermsAccepted(ctx, actor);
  if (node.type !== "forum") throw new ValidationError("Categories cannot hold threads.");
  checkNodePostingRules(ctx, actor, input.nodeId);
  if (input.attachmentIds?.length)
    requirePermission(ctx, actor, "forum.uploadAttachments", { nodeId: input.nodeId });
  return withSpamCheck(ctx, actor, input.body, "forum-post", (spam) => {
    const content = prepareModeratedContent(ctx, actor, input.body, true);
    permissionValue(ctx, actor, "mention.maxPerItem");
    const refs = renderModeratedContent(ctx, actor, content);
    const html = refs.html;
    const ids = writeTx(ctx, () => {
      const decision = prepareModeratedContent(ctx, actor, input.body, true);
      if (decision.source !== content.source)
        throw new ConflictError("Moderation rules changed; retry.");
      const settings = checkNodePostingRules(ctx, actor, input.nodeId);
      requireWriteRoom(ctx, actor, "thread", decision.floodSeconds);
      if (input.prefixId !== null) requireActivePrefix(ctx, input.prefixId);
      const state =
        decision.moderated ||
        spam ||
        (settings.require_thread_approval &&
          !can(ctx, actor, "forum.bypassNodeRules", { nodeId: input.nodeId }))
          ? "moderated"
          : "visible";
      const now = ctx.now();
      const thread = forumDb(ctx)
        .prepare<{ id: number }, [number, number, string, string, number, string, number | null]>(
          "INSERT INTO threads (node_id, user_id, title, state, created_at, last_post_at, last_poster_id, content_updated_at, excerpt, prefix_id) VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?2, ?5, ?6, ?7) RETURNING id",
        )
        .get(
          input.nodeId,
          user.userId,
          input.title,
          state,
          now,
          excerptFromMarkdown(content.source),
          input.prefixId,
        )!;
      const post = forumDb(ctx)
        .prepare<{ id: number }, [number, number, number]>(
          "INSERT INTO posts (thread_id, user_id, position, created_at) VALUES (?1, ?2, 0, ?3) RETURNING id",
        )
        .get(thread.id, user.userId, now)!;
      forumDb(ctx)
        .prepare(
          "INSERT INTO post_bodies (post_id, body_source, body_html, body_text) VALUES (?1, ?2, ?3, ?4)",
        )
        .run(post.id, refs.source, html, bbCodeText(refs.source));
      storeContentReferences(ctx, "post", post.id, refs);
      storeSpoilers(ctx, "post", post.id, refs.spoilers);
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
      logIp(ctx, actor, "thread", { type: "post", id: post.id });
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
  if (!readGates(ctx, actor).readsOthers(row.node_id)) throw new ForbiddenError(CONTENT_CLOSED);
  requirePermission(ctx, actor, "forum.reply", {
    nodeId: row.node_id,
    threadBanned: !!row.thread_banned,
  });
  if (row.is_locked) requirePermission(ctx, actor, "forum.replyLocked", { nodeId: row.node_id });
  requireTermsAccepted(ctx, actor);
  checkNodePostingRules(ctx, actor, row.node_id);
  if (input.attachmentIds?.length)
    requirePermission(ctx, actor, "forum.uploadAttachments", { nodeId: row.node_id });
  return withSpamCheck(ctx, actor, input.body, "reply", (spam) => {
    const content = prepareModeratedContent(ctx, actor, input.body, true);
    const refs = renderModeratedContent(ctx, actor, content);
    const html = refs.html;
    const id = writeTx(ctx, () => {
      const decision = prepareModeratedContent(ctx, actor, input.body, true);
      if (decision.source !== content.source)
        throw new ConflictError("Moderation rules changed; retry.");
      const current = threadRow(ctx, row.id)!;
      if (current.node_id !== row.node_id || current.state !== row.state)
        throw new ConflictError("Thread changed; retry.");
      const settings = checkNodePostingRules(ctx, actor, current.node_id);
      requireWriteRoom(ctx, actor, "reply", decision.floodSeconds);
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
        .prepare(
          "INSERT INTO post_bodies (post_id, body_source, body_html, body_text) VALUES (?1, ?2, ?3, ?4)",
        )
        .run(post.id, refs.source, html, bbCodeText(refs.source));
      storeContentReferences(ctx, "post", post.id, refs);
      storeSpoilers(ctx, "post", post.id, refs.spoilers);
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
      logIp(ctx, actor, "post", { type: "post", id: post.id });
      publishEvent(ctx, { type: "content.created", targetType: "post", targetId: post.id });
      return post.id;
    });
    return postValue(ctx, actor, id, true) as z.infer<typeof contracts.PostDetail>;
  });
});
export const threadsUpdateOp = implement(contracts.threadsUpdate, (ctx, actor, input) => {
  requireAuthenticated(actor);
  const { row } = requireThread(ctx, actor, input.threadId);
  if (input.title === undefined && input.prefixId === undefined)
    throw new ValidationError("Send a title, a prefix, or both.");
  if (!mayEditTitle(ctx, actor, row)) throw new ForbiddenError();
  requireTermsAccepted(ctx, actor);
  writeTx(ctx, () => {
    const moderator = currentActor(ctx, actor);
    const current = requireThread(ctx, moderator, row.id).row;
    if (!mayEditTitle(ctx, moderator, current)) throw new ForbiddenError();
    if (input.prefixId != null && input.prefixId !== current.prefix_id)
      requireActivePrefix(ctx, input.prefixId);
    forumDb(ctx)
      .prepare("UPDATE threads SET prefix_id = ?1, content_updated_at = ?2 WHERE id = ?3")
      .run(input.prefixId === undefined ? current.prefix_id : input.prefixId, ctx.now(), row.id);
    if (input.title !== undefined) {
      forumDb(ctx).prepare("UPDATE threads SET title = ?1 WHERE id = ?2").run(input.title, row.id);
      forumDb(ctx)
        .prepare("UPDATE nodes SET last_thread_title = ?1 WHERE id = ?2 AND last_thread_id = ?3")
        .run(input.title, current.node_id, row.id);
    }
    publishEvent(ctx, {
      type: "content.edited",
      targetType: "thread",
      targetId: row.id,
      payload: moderationPayload(actor, row.user_id, input),
    });
    if (can(ctx, moderator, "forum.editAny", { nodeId: current.node_id }))
      appendModeratorLog(
        ctx,
        actor,
        "thread.update",
        "thread",
        row.id,
        input.reason,
        input.prefixId === undefined ? {} : { prefixId: input.prefixId },
        current.node_id,
      );
  });
  return threadValue(ctx, actor, row.id);
});
export const threadsRemoveCoverOp = implement(contracts.threadsRemoveCover, (ctx, actor, input) => {
  requireAuthenticated(actor);
  const { row } = requireThread(ctx, actor, input.threadId);
  if (!mayRemoveCover(ctx, actor, row)) throw new ForbiddenError();
  writeTx(ctx, () => {
    const fresh = currentActor(ctx, actor);
    const current = requireThread(ctx, fresh, row.id).row;
    if (!mayRemoveCover(ctx, fresh, current)) throw new ForbiddenError();
    if (current.cover_id === null) return;
    forumDb(ctx)
      .prepare("UPDATE threads SET cover_id = NULL, content_updated_at = ?1 WHERE id = ?2")
      .run(ctx.now(), row.id);
    publishEvent(ctx, {
      type: "content.edited",
      targetType: "thread",
      targetId: row.id,
      payload: moderationPayload(actor, row.user_id, input),
    });
    if (can(ctx, fresh, "forum.editAny", { nodeId: current.node_id }))
      appendModeratorLog(
        ctx,
        actor,
        "thread.removeCover",
        "thread",
        row.id,
        input.reason,
        { coverId: current.cover_id },
        current.node_id,
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
  requireTermsAccepted(ctx, actor);
  const content = prepareModeratedContent(ctx, actor, input.body, false);
  const refs = renderModeratedContent(ctx, actor, content, {
    edit: { contentType: "post", contentId: post.id, authorId: post.user_id },
  });
  const html = refs.html;
  writeTx(ctx, () => {
    const moderator = currentActor(ctx, actor);
    const now = requirePost(ctx, moderator, post.id);
    if (
      !mayEdit(
        permissionsOf(ctx, moderator),
        now.thread.row.node_id,
        now.post,
        now.thread.row.is_locked,
      )
    )
      throw new ForbiddenError();
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
        requirePermission(ctx, moderator, "forum.uploadAttachments", {
          nodeId: now.thread.row.node_id,
        });
    }
    const decision = prepareModeratedContent(ctx, actor, input.body, false);
    if (decision.source !== content.source)
      throw new ConflictError("Moderation rules changed; retry.");
    recordPostRevision(ctx, actor, post.id);
    setAttachments(ctx, actorUserId(actor)!, "post", post.id, input.attachmentIds);
    validateEmbeddedAttachments(ctx, "post", post.id, html);
    forumDb(ctx)
      .prepare(
        "UPDATE post_bodies SET body_source = ?1, body_html = ?2, body_text = ?3 WHERE post_id = ?4",
      )
      .run(refs.source, html, bbCodeText(refs.source), post.id);
    const { newlyMentioned } = storeContentReferences(ctx, "post", post.id, refs);
    storeSpoilers(ctx, "post", post.id, refs.spoilers);
    if (decision.moderated) moderateEditedContent(ctx, moderator, { type: "post", id: post.id });
    // A holder of content.editSilently leaves no "edited" note.
    if (!can(ctx, moderator, "content.editSilently"))
      forumDb(ctx).prepare("UPDATE posts SET edited_at = ?1 WHERE id = ?2").run(ctx.now(), post.id);
    forumDb(ctx)
      .prepare("UPDATE threads SET content_updated_at = ?1 WHERE id = ?2")
      .run(ctx.now(), now.post.thread_id);
    if (post.id === now.thread.row.first_post_id)
      forumDb(ctx)
        .prepare("UPDATE threads SET excerpt = ?1 WHERE id = ?2")
        .run(excerptFromMarkdown(content.source), now.post.thread_id);
    publishEvent(ctx, {
      type: "content.edited",
      targetType: "post",
      targetId: post.id,
      payload: { ...moderationPayload(actor, post.user_id, input), newlyMentioned },
    });
    if (
      can(ctx, moderator, "forum.editAny", { nodeId: now.thread.row.node_id }) &&
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
        now.thread.row.node_id,
      );
  });
  return postValue(ctx, actor, post.id, true) as z.infer<typeof contracts.PostDetail>;
});

type Notice = { reason: string; notify: boolean; message?: string };
/**
 * The thread-level moderator actions below run inside a write transaction, as the moderator
 * stands now (`currentActor`), and return whether the thread differed afterwards. The single
 * operations and `threads.batchUpdate` share them, so a batch is judged exactly as one action is.
 */
function stickThread(ctx: Ctx, moderator: Actor, id: number, isSticky: boolean, notice: Notice) {
  const current = requireThread(ctx, moderator, id).row;
  requirePermission(ctx, moderator, "forum.stick", { nodeId: current.node_id });
  forumDb(ctx).prepare("UPDATE threads SET is_sticky = ?1 WHERE id = ?2").run(Number(isSticky), id);
  if (!!current.is_sticky !== isSticky)
    publishEvent(ctx, {
      type: "content.edited",
      targetType: "thread",
      targetId: id,
      payload: moderationPayload(moderator, current.user_id, notice),
    });
  appendModeratorLog(
    ctx,
    moderator,
    "thread.sticky",
    "thread",
    id,
    notice.reason,
    {
      isSticky,
    },
    current.node_id,
  );
  return !!current.is_sticky !== isSticky;
}
export const threadsSetStickyOp = implement(contracts.threadsSetSticky, (ctx, actor, input) => {
  requireAuthenticated(actor);
  const { row } = requireThread(ctx, actor, input.threadId);
  requirePermission(ctx, actor, "forum.stick", { nodeId: row.node_id });
  writeTx(ctx, () => {
    stickThread(ctx, currentActor(ctx, actor), row.id, input.isSticky, input);
  });
  return threadValue(ctx, actor, row.id);
});
function featureThread(
  ctx: Ctx,
  moderator: Actor,
  id: number,
  isFeatured: boolean,
  notice: Notice,
) {
  const current = requireThread(ctx, moderator, id).row;
  requirePermission(ctx, moderator, "forum.feature", { nodeId: current.node_id });
  const now = ctx.now();
  if (isFeatured) {
    if (current.state !== "visible")
      throw new ConflictError("Only a visible thread can be featured.");
    const picked = featureKinds(ctx, [id], now).get(id) === "staff";
    if (picked) return false;
    addFeature(ctx, {
      threadId: id,
      kind: "staff",
      userId: actorUserId(moderator)!,
      now,
      endsAt: null,
    });
  } else if (!endStaffFeature(ctx, id, now)) return false;
  appendModeratorLog(
    ctx,
    moderator,
    "thread.feature",
    "thread",
    id,
    notice.reason,
    { isFeatured },
    current.node_id,
  );
  return true;
}
export const threadsSetFeaturedOp = implement(contracts.threadsSetFeatured, (ctx, actor, input) => {
  requireAuthenticated(actor);
  const { row } = requireThread(ctx, actor, input.threadId);
  requirePermission(ctx, actor, "forum.feature", { nodeId: row.node_id });
  writeTx(ctx, () => {
    featureThread(ctx, currentActor(ctx, actor), row.id, input.isFeatured, {
      reason: input.reason,
      notify: false,
    });
  });
  return threadValue(ctx, actor, row.id);
});
/**
 * Who locks a thread: whoever holds forum.lock there, or its author with forum.lockOwn. The
 * author unlocks only a lock they put on themselves: the newest lock entry of the thread's log
 * is theirs (a lock staff set, or one that left no entry, stays).
 */
function mayLockThread(
  ctx: Ctx,
  actor: Actor,
  row: Pick<ThreadRow, "id" | "node_id" | "user_id">,
  isLocked: boolean,
): boolean {
  if (can(ctx, actor, "forum.lock", { nodeId: row.node_id })) return true;
  if (!can(ctx, actor, "forum.lockOwn", { nodeId: row.node_id, ownerId: row.user_id }))
    return false;
  if (isLocked) return true;
  const newest = forumDb(ctx)
    .prepare<{ actor_id: number; locked: number | null }, [number]>(forumSql.newestLock)
    .get(row.id);
  return newest?.actor_id === row.user_id && newest.locked === 1;
}
function lockThread(ctx: Ctx, moderator: Actor, id: number, isLocked: boolean, notice: Notice) {
  const current = requireThread(ctx, moderator, id).row;
  if (!mayLockThread(ctx, moderator, current, isLocked)) throw new ForbiddenError();
  // An author who does not hold forum.lock changes nothing and leaves nothing in the log when the
  // thread is already in the state asked for: a lock staff set must not become theirs by a repeat.
  if (
    !!current.is_locked === isLocked &&
    !can(ctx, moderator, "forum.lock", { nodeId: current.node_id })
  )
    return false;
  forumDb(ctx).prepare("UPDATE threads SET is_locked = ?1 WHERE id = ?2").run(Number(isLocked), id);
  if (!!current.is_locked !== isLocked)
    publishEvent(ctx, {
      type: "content.edited",
      targetType: "thread",
      targetId: id,
      payload: moderationPayload(moderator, current.user_id, notice),
    });
  appendModeratorLog(
    ctx,
    moderator,
    "thread.lock",
    "thread",
    id,
    notice.reason,
    {
      isLocked,
    },
    current.node_id,
  );
  return !!current.is_locked !== isLocked;
}
export const threadsSetLockedOp = implement(contracts.threadsSetLocked, (ctx, actor, input) => {
  requireAuthenticated(actor);
  const { row } = requireThread(ctx, actor, input.threadId);
  if (!mayLockThread(ctx, actor, row, input.isLocked)) throw new ForbiddenError();
  writeTx(ctx, () => {
    lockThread(ctx, currentActor(ctx, actor), row.id, input.isLocked, input);
  });
  return threadValue(ctx, actor, row.id);
});
function moveThread(ctx: Ctx, moderator: Actor, id: number, nodeId: number, notice: Notice) {
  assertTransferIdle(ctx, id);
  const current = requireThread(ctx, moderator, id).row;
  requirePermission(ctx, moderator, "forum.move", { nodeId: current.node_id });
  requirePermission(ctx, moderator, "node.view", { nodeId }, { notFound: true });
  requirePermission(ctx, moderator, "forum.move", { nodeId });
  if (current.node_id === nodeId) {
    appendModeratorLog(
      ctx,
      moderator,
      "thread.move",
      "thread",
      id,
      notice.reason,
      {
        nodeId,
        changed: false,
      },
      current.node_id,
    );
    return false;
  }
  forumDb(ctx).prepare("UPDATE threads SET node_id = ?1 WHERE id = ?2").run(nodeId, id);
  forumDb(ctx)
    .prepare(
      "UPDATE report_groups SET node_id = ?1 WHERE target_type = 'post' AND target_id IN (SELECT id FROM posts WHERE thread_id = ?2)",
    )
    .run(nodeId, id);
  forumDb(ctx)
    .prepare(
      "UPDATE moderator_log SET node_id = ?1 WHERE target_type = 'post' AND target_id IN (SELECT id FROM posts WHERE thread_id = ?2)",
    )
    .run(nodeId, id);
  forumDb(ctx)
    .prepare(
      "UPDATE moderator_log SET node_id = ?1 WHERE target_type = 'thread' AND target_id = ?2",
    )
    .run(nodeId, id);
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
      .run(1, current.reply_count + 1, nodeId);
    updateNodeLast(ctx, current.node_id);
    updateNodeLast(ctx, nodeId);
  }
  publishEvent(ctx, {
    type: "content.edited",
    targetType: "thread",
    targetId: id,
    payload: moderationPayload(moderator, current.user_id, notice),
  });
  appendModeratorLog(
    ctx,
    moderator,
    "thread.move",
    "thread",
    id,
    notice.reason,
    { nodeId },
    nodeId,
  );
  return true;
}
/** The target of a move: a forum the actor can see and move threads into. */
function requireMoveTarget(ctx: Ctx, actor: Actor, nodeId: number) {
  const target = requireNode(ctx, actor, nodeId);
  requirePermission(ctx, actor, "forum.move", { nodeId });
  if (target.node.type !== "forum")
    throw new ValidationError("Threads can only be moved to forums.");
}
export const threadsMoveOp = implement(contracts.threadsMove, (ctx, actor, input) => {
  requireAuthenticated(actor);
  assertTransferIdle(ctx, input.threadId);
  const { row } = requireThread(ctx, actor, input.threadId);
  requirePermission(ctx, actor, "forum.move", { nodeId: row.node_id });
  requireMoveTarget(ctx, actor, input.nodeId);
  writeTx(ctx, () => {
    moveThread(ctx, currentActor(ctx, actor), row.id, input.nodeId, input);
  });
  return threadValue(ctx, actor, row.id);
});
function deleteThread(ctx: Ctx, moderator: Actor, id: number, notice: Notice) {
  assertTransferIdle(ctx, id);
  const current = requireThread(ctx, moderator, id).row;
  if (!mayDeleteThread(permissionsOf(ctx, moderator), current)) throw new ForbiddenError();
  const changed = changeThreadState(ctx, id, "deleted");
  if (changed)
    publishEvent(ctx, {
      type: "content.deleted",
      targetType: "thread",
      targetId: id,
      payload: {
        previousState: current.state,
        state: "deleted",
        ...moderationPayload(moderator, current.user_id, notice),
      },
    });
  // A member hiding their own thread is not a moderator's action: no log entry, as with posts.
  if (can(ctx, moderator, "forum.deleteAny", { nodeId: current.node_id }))
    appendModeratorLog(
      ctx,
      moderator,
      "thread.delete",
      "thread",
      id,
      notice.reason,
      {},
      current.node_id,
    );
  return changed;
}
export const threadsDeleteOp = implement(contracts.threadsDelete, (ctx, actor, input) => {
  requireAuthenticated(actor);
  assertTransferIdle(ctx, input.threadId);
  const { row } = requireThread(ctx, actor, input.threadId);
  if (!mayDeleteThread(permissionsOf(ctx, actor), row)) throw new ForbiddenError();
  writeTx(ctx, () => {
    deleteThread(ctx, currentActor(ctx, actor), row.id, input);
  });
  return threadValue(ctx, actor, row.id);
});
function restoreThread(ctx: Ctx, moderator: Actor, id: number, notice: Notice) {
  assertTransferIdle(ctx, id);
  const current = requireThread(ctx, moderator, id).row;
  requireRestorer(ctx, moderator, current.state, current.node_id);
  if (current.state === "deleted") assertRemovalNotBegun(ctx, "thread", id);
  const changed = changeThreadState(ctx, id, "visible");
  if (changed)
    publishEvent(ctx, {
      type: "content.state_changed",
      targetType: "thread",
      targetId: id,
      payload: {
        previousState: current.state,
        state: "visible",
        ...moderationPayload(moderator, current.user_id, notice),
      },
    });
  appendModeratorLog(
    ctx,
    moderator,
    "thread.restore",
    "thread",
    id,
    notice.reason,
    {},
    current.node_id,
  );
  return changed;
}
export const threadsRestoreOp = implement(contracts.threadsRestore, (ctx, actor, input) => {
  requireAuthenticated(actor);
  assertTransferIdle(ctx, input.threadId);
  const { row } = requireThread(ctx, actor, input.threadId);
  requireRestorer(ctx, actor, row.state, row.node_id);
  writeTx(ctx, () => {
    restoreThread(ctx, currentActor(ctx, actor), row.id, input);
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
    const moderator = currentActor(ctx, actor);
    const current = requirePost(ctx, moderator, post.id).thread.row;
    if (!mayDelete(permissionsOf(ctx, moderator), current.node_id, post.user_id, current.is_locked))
      throw new ForbiddenError();
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
    if (can(ctx, moderator, "forum.deleteAny", { nodeId: current.node_id }))
      appendModeratorLog(
        ctx,
        actor,
        "post.delete",
        "post",
        post.id,
        input.reason,
        {},
        current.node_id,
      );
  });
  return postValue(ctx, actor, post.id);
});
export const postsRestoreOp = implement(contracts.postsRestore, (ctx, actor, input) => {
  requireAuthenticated(actor);
  const { post, thread } = requirePost(ctx, actor, input.postId);
  const nodeId = thread.row.node_id;
  requireRestorer(ctx, actor, post.state, nodeId);
  writeTx(ctx, () => {
    const moderator = currentActor(ctx, actor);
    const current = requirePost(ctx, moderator, post.id);
    requireRestorer(ctx, moderator, current.post.state, current.thread.row.node_id);
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
      current.thread.row.node_id,
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
    const cleared = statement<unknown, [number, number, number, number]>(
      ctx,
      "clearThreadNotices",
      forumSql.clearThreadNotices,
    ).run(ctx.now(), user.userId, row.id, post.id).changes;
    if (cleared)
      forumDb(ctx)
        .prepare(
          "UPDATE users SET unread_notification_count = unread_notification_count - ?1 WHERE id = ?2",
        )
        .run(cleared, user.userId);
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
    const count = mergeInOrder(streams, 500, (post) => {
      update.run(-next - 1, post.id);
      next++;
    });
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
        requireCurrentSplitter(ctx, actor, source.id, input.nodeId);
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
    requireCurrentSplitter(ctx, actor, source.id, input.nodeId);
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
      requireCurrentMerger(ctx, actor, [target.id, ...retrySources]);
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
    requireCurrentMerger(ctx, actor, [target.id, ...input.sourceThreadIds]);
    // A thread whose removal for good has begun is not merged either way.
    for (const id of [target.id, ...input.sourceThreadIds])
      if (threadRow(ctx, id)?.state === "deleted") assertRemovalNotBegun(ctx, "thread", id);
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

/** A thread's prefix set or cleared, as `threads.update` allows it. */
function setThreadPrefix(
  ctx: Ctx,
  moderator: Actor,
  id: number,
  prefixId: number | null,
  notice: Notice,
) {
  const current = requireThread(ctx, moderator, id).row;
  if (!mayEditTitle(ctx, moderator, current)) throw new ForbiddenError();
  if (prefixId === current.prefix_id) return false;
  if (prefixId !== null) requireActivePrefix(ctx, prefixId);
  forumDb(ctx)
    .prepare("UPDATE threads SET prefix_id = ?1, content_updated_at = ?2 WHERE id = ?3")
    .run(prefixId, ctx.now(), id);
  publishEvent(ctx, {
    type: "content.edited",
    targetType: "thread",
    targetId: id,
    payload: moderationPayload(moderator, current.user_id, notice),
  });
  if (can(ctx, moderator, "forum.editAny", { nodeId: current.node_id }))
    appendModeratorLog(
      ctx,
      moderator,
      "thread.update",
      "thread",
      id,
      notice.reason,
      { prefixId },
      current.node_id,
    );
  return true;
}
function batchItem(
  ctx: Ctx,
  moderator: Actor,
  id: number,
  update: z.infer<typeof contracts.ThreadBatchUpdate>,
  notice: Notice,
): boolean {
  switch (update.action) {
    case "move":
      return moveThread(ctx, moderator, id, update.nodeId, notice);
    case "lock":
    case "unlock":
      return lockThread(ctx, moderator, id, update.action === "lock", notice);
    case "stick":
    case "unstick":
      return stickThread(ctx, moderator, id, update.action === "stick", notice);
    case "delete":
      return deleteThread(ctx, moderator, id, notice);
    case "restore":
      return restoreThread(ctx, moderator, id, notice);
    case "feature":
    case "unfeature":
      return featureThread(ctx, moderator, id, update.action === "feature", notice);
    case "setPrefix":
      return setThreadPrefix(ctx, moderator, id, update.prefixId, notice);
  }
}
/**
 * What one batch may do to the posts of its threads. Deleting, restoring and moving a thread cost
 * in proportion to its posts (author counters, reports and log rows are updated by post), so a
 * batch of them stops taking threads once their posts add up to this many. The first thread is
 * always taken, as the single action would take it.
 */
export const BATCH_POST_BUDGET = 250_000;
const BY_POSTS = new Set(["delete", "restore", "move"]);

export const threadsBatchUpdateOp = implement(contracts.threadsBatchUpdate, (ctx, actor, input) => {
  requireAuthenticated(actor);
  if (input.update.action === "move") requireMoveTarget(ctx, actor, input.update.nodeId);
  return writeTx(ctx, () => {
    const moderator = currentActor(ctx, actor);
    // Each thread in its own savepoint: a refused one is undone alone and the others stay.
    let spent = 0;
    const results = input.threadIds.map((threadId) => {
      try {
        const changed = writeTx(ctx, () => {
          let cost = 0;
          if (BY_POSTS.has(input.update.action)) {
            cost = requireThread(ctx, moderator, threadId).row.reply_count + 1;
            if (spent > 0 && spent + cost > BATCH_POST_BUDGET)
              throw new ConflictError(
                "Too many posts for one batch. Try this thread again in a smaller batch.",
              );
          }
          const done = batchItem(ctx, moderator, threadId, input.update, input);
          if (done) spent += cost;
          return done;
        });
        return { threadId, changed, error: null };
      } catch (error) {
        if (!(error instanceof SermoError)) throw error;
        return { threadId, changed: false, error: { code: error.code, message: error.message } };
      }
    });
    return { results };
  });
});

// Deleting for good ---------------------------------------------------------------------------

/**
 * After posts of a thread were removed: a read marker may not point past the thread's last
 * visible post (SQLite can give the id of a removed newest post to the next insert, which would
 * then count as read), and the thread's last-post pointer must name a post that exists.
 */
function settleThreadAfterPurge(ctx: Ctx, threadId: number, firstPostId: number | null) {
  const last = forumDb(ctx)
    .prepare<{ id: number; user_id: number; created_at: number }, [number]>(forumSql.threadLast)
    .get(threadId);
  if (last)
    forumDb(ctx)
      .prepare(
        "UPDATE threads SET last_post_at = ?1, last_post_id = ?2, last_poster_id = ?3 WHERE id = ?4",
      )
      .run(last.created_at, last.id, last.user_id, threadId);
  const newest = last?.id ?? firstPostId ?? 0;
  if (!last && firstPostId)
    forumDb(ctx)
      .prepare(
        "UPDATE threads SET last_post_id = ?1, last_post_at = created_at, last_poster_id = user_id WHERE id = ?2",
      )
      .run(firstPostId, threadId);
  forumDb(ctx)
    .prepare(
      "UPDATE thread_reads SET last_read_post_id = ?1 WHERE thread_id = ?2 AND last_read_post_id > ?1",
    )
    .run(newest, threadId);
}

/**
 * How a member deletes content for good: staff with forum.hardDelete take content that is
 * already soft-deleted; an author with forum.hardDeleteOwn takes their own content in one step
 * (it is hidden here, then removed), never in a locked thread and never what staff hid.
 */
function hardDeletePath(
  ctx: Ctx,
  actor: Actor,
  row: Pick<ThreadRow, "node_id" | "is_locked">,
  ownerId: number,
  state: State,
): "staff" | "own" {
  const staff = can(ctx, actor, "forum.hardDelete", { nodeId: row.node_id });
  if (staff && state === "deleted") return "staff";
  if (!row.is_locked && can(ctx, actor, "forum.hardDeleteOwn", { nodeId: row.node_id, ownerId })) {
    if (state === "deleted")
      throw new ConflictError("Content that was hidden by staff cannot be deleted by its author.");
    return "own";
  }
  if (staff) return "staff";
  throw new ForbiddenError();
}

/** Reports on content are staff's to settle: their author does not delete the content under them. */
function requireNotReported(ctx: Ctx, postIds: number[], threadId?: number): void {
  const reported = forumDb(ctx)
    .prepare<{ n: number }, [string, number]>(
      "SELECT 1 AS n FROM report_groups WHERE (target_type = 'post' AND target_id IN (SELECT value FROM json_each(?1))) OR (target_type = 'thread' AND target_id = ?2) LIMIT 1",
    )
    .get(JSON.stringify(postIds), threadId ?? 0);
  if (reported)
    throw new ConflictError("This has been reported. Hide it, or ask staff to delete it.");
}

export const threadsHardDeleteOp = implement(contracts.threadsHardDelete, (ctx, actor, input) => {
  requireAuthenticated(actor);
  assertTransferIdle(ctx, input.threadId);
  const { row } = requireThread(ctx, actor, input.threadId);
  hardDeletePath(ctx, actor, row, row.user_id, row.state);
  return writeTx(ctx, () => {
    assertTransferIdle(ctx, row.id);
    const moderator = currentActor(ctx, actor);
    const current = requireThread(ctx, moderator, row.id).row;
    const path = hardDeletePath(ctx, moderator, current, current.user_id, current.state);
    if (path === "staff" && current.state !== "deleted")
      throw new ConflictError(
        "Delete the thread first; only a deleted thread can be removed for good.",
      );
    if (path === "own") changeThreadState(ctx, current.id, "deleted");
    // Newest posts first, the opening post with the last of them.
    const found = forumDb(ctx)
      .prepare<{ id: number; state: State; user_id: number }, [number, number, number]>(
        "SELECT id, state, user_id FROM posts WHERE thread_id = ?1 AND id != ?2 ORDER BY position DESC, id DESC LIMIT ?3",
      )
      .all(current.id, current.first_post_id ?? 0, PURGE_CHUNK + 1);
    const more = found.length > PURGE_CHUNK;
    if (path === "own") {
      // An author takes back their own thread, not other members' words, and only what one call
      // can finish: the pieces of a long thread would need the thread to stay open to them.
      if (found.some((post) => post.user_id !== current.user_id))
        throw new ConflictError(
          "This thread holds other members' posts. Hide it, or ask staff to delete it.",
        );
      if (more)
        throw new ConflictError(
          "This thread is too long to delete in one step. Hide it, or ask staff to delete it.",
        );
      // What staff hid, and what has been reported, is evidence: the author does not remove it.
      if (
        forumDb(ctx)
          .prepare<{ n: number }, [number]>(
            "SELECT 1 AS n FROM posts WHERE thread_id = ?1 AND state = 'deleted' LIMIT 1",
          )
          .get(current.id)
      )
        throw new ConflictError(
          "Staff hid part of this thread. Hide the thread, or ask staff to delete it.",
        );
      requireNotReported(
        ctx,
        [
          ...found.map((post) => post.id),
          ...(current.first_post_id ? [current.first_post_id] : []),
        ],
        current.id,
      );
    }
    const chunk = found.slice(0, PURGE_CHUNK);
    const ids = chunk.map((post) => post.id);
    if (!more && current.first_post_id) ids.push(current.first_post_id);
    purgeContent(ctx, "post", ids);
    if (more) {
      // The thread stays, deleted: keep its own figures true for the staff who can still open it.
      const visibleGone = chunk.filter((post) => post.state === "visible").length;
      forumDb(ctx)
        .prepare("UPDATE threads SET reply_count = max(0, reply_count - ?1) WHERE id = ?2")
        .run(visibleGone, current.id);
      settleThreadAfterPurge(ctx, current.id, current.first_post_id);
    } else {
      purgeThread(ctx, current.id);
    }
    // The title and author stay in the log: the thread itself will not.
    appendModeratorLog(
      ctx,
      actor,
      "thread.hardDelete",
      "thread",
      current.id,
      input.reason,
      {
        title: current.title,
        authorId: current.user_id,
        removedPosts: ids.length,
        completed: !more,
      },
      current.node_id,
    );
    return { completed: !more, removedPosts: ids.length };
  });
});
export const postsHardDeleteOp = implement(contracts.postsHardDelete, (ctx, actor, input) => {
  requireAuthenticated(actor);
  const { post, thread } = requirePost(ctx, actor, input.postId);
  assertTransferIdle(ctx, thread.row.id);
  hardDeletePath(ctx, actor, thread.row, post.user_id, post.state);
  return writeTx(ctx, () => {
    assertTransferIdle(ctx, thread.row.id);
    const moderator = currentActor(ctx, actor);
    const current = requirePost(ctx, moderator, post.id);
    const path = hardDeletePath(
      ctx,
      moderator,
      current.thread.row,
      current.post.user_id,
      current.post.state,
    );
    if (current.post.id === current.thread.row.first_post_id)
      throw new ValidationError("Delete the thread instead.");
    if (path === "staff" && current.post.state !== "deleted")
      throw new ConflictError(
        "Delete the post first; only a deleted post can be removed for good.",
      );
    if (path === "own") {
      requireNotReported(ctx, [current.post.id]);
      changePostState(ctx, current.post.id, "deleted");
    }
    purgeContent(ctx, "post", [post.id]);
    settleThreadAfterPurge(ctx, current.thread.row.id, current.thread.row.first_post_id);
    appendModeratorLog(
      ctx,
      actor,
      "post.hardDelete",
      "post",
      post.id,
      input.reason,
      { threadId: current.thread.row.id, authorId: post.user_id },
      current.thread.row.node_id,
    );
    return { ok: true as const };
  });
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
  threadsRemoveCoverOp,
  threadsSetStickyOp,
  threadsSetFeaturedOp,
  threadsSetLockedOp,
  threadsMoveOp,
  threadsDeleteOp,
  threadsRestoreOp,
  threadsHardDeleteOp,
  threadsBatchUpdateOp,
  threadsMarkReadOp,
  threadsMergeOp,
  threadsSplitOp,
  postsListOp,
  postsGetOp,
  postsCreateOp,
  postsUpdateOp,
  postsDeleteOp,
  postsRestoreOp,
  postsHardDeleteOp,
  ...forumPrefixOperations,
];
