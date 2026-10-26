import type { SQLQueryBindings } from "bun:sqlite";
import * as z from "zod";
import type { Actor } from "../../actor";
import { actorUserId, requireAuthenticated } from "../../actor";
import { type Ctx, invalidate, prepared } from "../../context";
import * as contracts from "../../contracts/forums";
import { isReservedUsername } from "../../db/auth-options";
import { GUEST_ACCOUNT_ID } from "../../db/schema";
import { writeTx } from "../../db/tx";
import {
  AdultContentError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  SermoError,
  UnauthenticatedError,
  ValidationError,
} from "../../errors";
import { publishEvent } from "../../events";
import { MAX_THREAD_TAGS } from "../../limits";
import { implement, markPublic } from "../../operation";
import { decodeCursor, encodeCursor } from "../../pagination";
import {
  type AdultOption,
  adultRefusalFor,
  can,
  currentActor,
  currentVersions,
  getNodeTree,
  type NodeTreeEntry,
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
import { requireMessageRoom } from "../conversations";
import {
  completeRunningJob,
  enqueueJob,
  registerJobHandler,
  schedulePostCountRecount,
} from "../jobs";
import { requireSiteView } from "../members/site-access";
import {
  appendModeratorLog,
  moderateEditedContent,
  prepareGuestContent,
  prepareModeratedContent,
  recordPostRevision,
  renderModeratedContent,
  requireGuestWriteRoom,
  requireWriteRoom,
  withSpamCheck,
} from "../moderation";
import { deleterIds, deletionValue, loadDeletions } from "../moderation/deletions";
import { requireTermsAccepted } from "../pages/acceptance";
import { enqueuePollPurge } from "../polls/jobs";
import { mayAddPoll } from "../polls/policy";
import {
  insertPoll,
  isRetiring,
  movePoll,
  pollKindsOf,
  pollOfThread,
  retirePoll,
} from "../polls/store";
import { cleanPoll } from "../polls/text";
import {
  assertRemovalNotBegun,
  PURGE_CHUNK,
  pollNeedingBatches,
  purgeContent,
  purgeThread,
} from "../purge/purge";
import { type ClientAddress, parseAddress } from "../security/address";
import { isBotAgent } from "../security/device";
import { logIp, logMemberIp } from "../security/log";
import { seoForNode, seoForThread } from "../seo";
import { excerptFromMarkdown } from "../seo/excerpt";
import { canonicalUrl } from "../seo/paths";
import { checkTurnstile, publicTurnstile, TurnstileRefusal } from "../settings/turnstile";
import { blockedAmong } from "../social/blocks";
import { bodiesWithoutBlockedQuotes } from "../social/quotes";
import { resolvedFileUrl } from "../storage/url";
import {
  hashtagRules,
  mayTag,
  requireTagChange,
  requireTagCreate,
  tagRights,
} from "../tags/policy";
import {
  addThreadTags,
  manualTagCount,
  moveThreadTags,
  replaceThreadTags,
  syncPostTags,
  tagKeys,
  threadTagNames,
} from "../tags/store";
import { seenLastPosts, threadStarters } from "./blocks";
import { addFeature, endStaffFeature, featureKinds } from "./features";
import { cleanGuestName, contentAuthor, isGuestAuthor } from "./guest-author";
import { nodesDeleteOp, registerNodeDeleteJob, requireNotBeingDeleted } from "./node-delete";
import {
  forumPrefixOperations,
  offerEveryActivePrefix,
  requireActivePrefix,
  requirePrefixChosen,
  setOfferedPrefixes,
} from "./prefixes";
import { nodeTabs, threadPresenter } from "./presentation";
import { type ReadGates, readGates } from "./read-gates";
import {
  nodesMarkAllReadOp,
  nodesMarkReadOp,
  nodesUnreadOp,
  positionBeforeMark,
  readMarksOf,
} from "./read-marks";

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
  guest_name: string | null;
  merged_into_id: number | null;
  excerpt: string;
  prefix_id: number | null;
  cover_id: number | null;
  highlighted_until: number | null;
  bumped_at: number | null;
  sort_at: number;
  /** The thread's own +18 mark (its forum's is the node tree's). */
  is_adult: number;
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
  guest_name: string | null;
  body_html?: string;
  body_source?: string;
};
type NodeRow = {
  id: number;
  require_thread_approval: number;
  require_reply_approval: number;
  require_prefix: number;
  is_read_only: number;
  counts_posts: number;
  min_account_age_days: number;
  min_post_count: number;
  is_adult: number;
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
  "id, node_id, user_id, title, state, is_sticky, is_locked, created_at, reply_count, view_count, first_post_id, last_post_at, last_post_id, last_poster_id, guest_name, merged_into_id, excerpt, prefix_id, cover_id, highlighted_until, bumped_at, sort_at, is_adult";
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
const postColumns = `p.id, p.thread_id, p.user_id, ${storedPosition("p.position")} AS position, p.state, p.created_at, p.edited_at, p.reaction_counts, p.attachment_count, p.guest_name`;
const nodeColumns =
  "id, icon_file_id, icon_key, cover_file_id, thread_count, post_count, last_post_at, last_post_id, last_thread_id, last_thread_title, last_poster_id, require_thread_approval, require_reply_approval, require_prefix, is_read_only, counts_posts, min_account_age_days, min_post_count, is_adult";
// The thread at a place in a forum's list (?5, from 0), for numbered pages (see `forumSql`).
const threadKeySql = `SELECT sort_at, id FROM threads WHERE node_id = ?1 AND is_sticky = 0 AND merged_into_id IS NULL AND (state = 'visible' OR (state = 'moderated' AND (?2 = 1 OR user_id = ?4)) OR (state = 'deleted' AND ?3 = 1)) ORDER BY sort_at DESC, id DESC LIMIT 1 OFFSET ?5`;
const threadKeyByPrefixSql = `SELECT sort_at, id FROM threads WHERE node_id = ?1 AND is_sticky = 0 AND prefix_id = ?6 AND merged_into_id IS NULL AND (state = 'visible' OR (state = 'moderated' AND (?2 = 1 OR user_id = ?4)) OR (state = 'deleted' AND ?3 = 1)) ORDER BY sort_at DESC, id DESC LIMIT 1 OFFSET ?5`;
/** SQL shared by the hot paths and their query-plan tests. */
export const forumSql = {
  sticky: `SELECT ${threadColumns} FROM threads WHERE node_id = ?1 AND is_sticky = 1 AND merged_into_id IS NULL AND (state = 'visible' OR (state = 'moderated' AND (?2 = 1 OR user_id = ?4)) OR (state = 'deleted' AND ?3 = 1)) ORDER BY sort_at DESC, id DESC`,
  stickyByPrefix: `SELECT ${threadColumns} FROM threads WHERE node_id = ?1 AND is_sticky = 1 AND prefix_id = ?5 AND merged_into_id IS NULL AND (state = 'visible' OR (state = 'moderated' AND (?2 = 1 OR user_id = ?4)) OR (state = 'deleted' AND ?3 = 1)) ORDER BY sort_at DESC, id DESC`,
  threadPage: `SELECT ${threadColumns} FROM threads WHERE node_id = ?1 AND is_sticky = 0 AND merged_into_id IS NULL AND (state = 'visible' OR (state = 'moderated' AND (?2 = 1 OR user_id = ?7)) OR (state = 'deleted' AND ?3 = 1)) AND (sort_at, id) < (?4, ?5) ORDER BY sort_at DESC, id DESC LIMIT ?6`,
  threadPageByPrefix: `SELECT ${threadColumns} FROM threads WHERE node_id = ?1 AND is_sticky = 0 AND prefix_id = ?8 AND merged_into_id IS NULL AND (state = 'visible' OR (state = 'moderated' AND (?2 = 1 OR user_id = ?7)) OR (state = 'deleted' AND ?3 = 1)) AND (sort_at, id) < (?4, ?5) ORDER BY sort_at DESC, id DESC LIMIT ?6`,
  /**
   * Numbered pages of threads.list: the key of the thread at a place in the list (?5, from 0), the
   * last one of the page before (the page then goes on from it as a cursor's would), and how many
   * threads the list holds where no counter says it (a prefix, or only the viewer's own threads).
   */
  threadKey: threadKeySql,
  threadKeyByPrefix: threadKeyByPrefixSql,
  /** The same places counted from the oldest thread: the nearer end of a long forum. */
  threadKeyFromOldest: fromOldest(threadKeySql),
  threadKeyByPrefixFromOldest: fromOldest(threadKeyByPrefixSql),
  threadCount: `SELECT count(*) AS n FROM threads WHERE node_id = ?1 AND is_sticky = 0 AND merged_into_id IS NULL AND (state = 'visible' OR (state = 'moderated' AND (?2 = 1 OR user_id = ?4)) OR (state = 'deleted' AND ?3 = 1))`,
  threadCountByPrefix: `SELECT count(*) AS n FROM threads WHERE node_id = ?1 AND is_sticky = 0 AND prefix_id = ?5 AND merged_into_id IS NULL AND (state = 'visible' OR (state = 'moderated' AND (?2 = 1 OR user_id = ?4)) OR (state = 'deleted' AND ?3 = 1))`,
  /** The forum's stored count of visible threads, and the visible sticky ones in it (a few rows). */
  nodeThreadCount: "SELECT thread_count AS n FROM nodes WHERE id = ?1",
  visibleStickyCount:
    "SELECT count(*) AS n FROM threads WHERE node_id = ?1 AND is_sticky = 1 AND state = 'visible'",
  /** Non-sticky threads of one hidden state ?2 in a forum, all of them (?3 = 1) or the viewer's (?4). */
  hiddenThreadCount:
    "SELECT count(*) AS n FROM threads INDEXED BY threads_node_state_id WHERE node_id = ?1 AND state = ?2 AND is_sticky = 0 AND merged_into_id IS NULL AND (?3 = 1 OR user_id = ?4)",
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
   * The newest lock or unlock of a thread, by the single tool or the bulk one, from the events
   * they publish (an author's own lock is not a moderator action and is never in the moderator
   * log): whether it locked, and who did it when that was not the author (`actorId` is set only
   * when someone acts on another member's thread). Index seek on the events' target.
   */
  newestLock:
    "SELECT json_extract(payload, '$.isLocked') AS locked, json_extract(payload, '$.actorId') AS actor_id FROM domain_events WHERE target_type = 'thread' AND target_id = ?1 AND type = 'content.edited' AND json_extract(payload, '$.isLocked') IS NOT NULL ORDER BY id DESC LIMIT 1",
  /** Whether any node is marked +18 (the node table is small). */
  anyAdultNode: "SELECT 1 AS n FROM nodes WHERE is_adult = 1 LIMIT 1",
  /** The newest change of a thread's +18 mark, and who made it when that was not the author. */
  newestAdultMark:
    "SELECT json_extract(payload, '$.actorId') AS actor_id FROM domain_events WHERE target_type = 'thread' AND target_id = ?1 AND type = 'content.edited' AND json_extract(payload, '$.isAdult') IS NOT NULL ORDER BY id DESC LIMIT 1",
  warnedAbout:
    "SELECT 1 AS n FROM moderator_log WHERE target_type = 'user' AND target_id = ?1 AND action = 'warning.add' AND json_extract(details, '$.postId') IN (SELECT value FROM json_each(?2)) AND EXISTS (SELECT 1 FROM warnings w WHERE w.id = json_extract(details, '$.warningId')) LIMIT 1",
  threadsByIds: `SELECT ${threadColumns} FROM threads WHERE id IN (SELECT value FROM json_each(?1))`,
  postsByIds: `SELECT ${postColumns}, b.body_html FROM posts p JOIN post_bodies b ON b.post_id = p.id WHERE p.id IN (SELECT value FROM json_each(?1))`,
  maxPostPosition: "SELECT position FROM posts WHERE thread_id = ?1 ORDER BY position DESC LIMIT 1",
  guestNameTaken: "SELECT id FROM users WHERE username_key = ?1",
  lastPostPositions: `SELECT id, ${storedPosition("position")} AS position, guest_name FROM posts WHERE id IN (SELECT value FROM json_each(?1))`,
  readBatch:
    "SELECT thread_id, last_read_post_id, last_read_position FROM thread_reads WHERE user_id = ?1 AND thread_id IN (SELECT value FROM json_each(?2))",
  nodeLast:
    "SELECT id, title, last_post_at, last_post_id, last_poster_id FROM threads WHERE node_id = ?1 AND is_sticky = ?2 AND state = 'visible' ORDER BY last_post_at DESC, id DESC LIMIT 1",
  threadLast:
    "SELECT id, user_id, created_at FROM posts WHERE thread_id = ?1 AND state = 'visible' ORDER BY position DESC, id DESC LIMIT 1",
  /** Adds ?1 to the count of every visible post's author in thread ?2, if forum ?3 counts posts. */
  authorAdjustment:
    "UPDATE users SET post_count = max(0, post_count + ?1 * authors.n) FROM (SELECT user_id, count(*) AS n FROM posts WHERE thread_id = ?2 AND state = 'visible' GROUP BY user_id) AS authors WHERE users.id = authors.user_id AND (SELECT counts_posts FROM nodes WHERE id = ?3) = 1",
  readPost:
    "SELECT id, position FROM posts WHERE thread_id = ?1 AND position <= ?2 AND state = 'visible' ORDER BY position DESC LIMIT 1",
  decodedReadPost: `SELECT p.id, ${storedPosition("p.position")} AS position FROM posts p WHERE p.thread_id = ?1 AND (p.position BETWEEN 0 AND ?2 OR p.position BETWEEN -?2 - 1 AND -1) AND p.state = 'visible' ORDER BY ${storedPosition("p.position")} DESC LIMIT 1`,
  readPosition: "SELECT last_read_position FROM thread_reads WHERE user_id = ?1 AND thread_id = ?2",
  // Unread state uses post ids: reading a post clears notices for it and every older post.
  clearThreadNotices:
    "UPDATE notifications INDEXED BY notifications_user_thread SET read_at = ?1 WHERE user_id = ?2 AND thread_id = ?3 AND epoch = (SELECT notification_epoch FROM users WHERE id = ?2) AND read_at IS NULL AND type IN ('thread.watched', 'node.thread', 'node.post', 'content.quoted', 'content.mentioned', 'member.thread') AND (content_type = 'thread' OR (content_type = 'post' AND content_id <= ?4))",
} as const;
/** A positional read of the thread list walked from its oldest end. */
function fromOldest(sql: string): string {
  return sql.replace("ORDER BY sort_at DESC, id DESC", "ORDER BY sort_at, id");
}
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
  threadKey: ownOnly(forumSql.threadKey, 4),
  threadKeyByPrefix: ownOnly(forumSql.threadKeyByPrefix, 4),
  threadKeyFromOldest: ownOnly(forumSql.threadKeyFromOldest, 4),
  threadKeyByPrefixFromOldest: ownOnly(forumSql.threadKeyByPrefixFromOldest, 4),
  threadCount: ownOnly(forumSql.threadCount, 4),
  threadCountByPrefix: ownOnly(forumSql.threadCountByPrefix, 4),
} as const;
/**
 * The same listing statements for a viewer who may not see +18 content: a thread marked +18 is
 * left out unless it is the viewer's own (parameter `viewer`). Only own lists need no variant.
 */
const adultFree = (sql: string, viewer: number) =>
  sql.replace(
    "merged_into_id IS NULL",
    `merged_into_id IS NULL AND (is_adult = 0 OR user_id = ?${viewer})`,
  );
export const adultFreeThreadSql = {
  sticky: adultFree(forumSql.sticky, 4),
  stickyByPrefix: adultFree(forumSql.stickyByPrefix, 4),
  threadPage: adultFree(forumSql.threadPage, 7),
  threadPageByPrefix: adultFree(forumSql.threadPageByPrefix, 7),
  threadKey: adultFree(forumSql.threadKey, 4),
  threadKeyByPrefix: adultFree(forumSql.threadKeyByPrefix, 4),
  threadKeyFromOldest: adultFree(forumSql.threadKeyFromOldest, 4),
  threadKeyByPrefixFromOldest: adultFree(forumSql.threadKeyByPrefixFromOldest, 4),
  threadCount: adultFree(forumSql.threadCount, 4),
  threadCountByPrefix: adultFree(forumSql.threadCountByPrefix, 4),
  /**
   * The non-sticky threads marked +18 that the plain list holds but such a viewer is not shown
   * (?2 the viewer, ?3 view-moderated, ?4 view-deleted): the few rows of the partial index.
   */
  hiddenAdultCount:
    "SELECT count(*) AS n FROM threads INDEXED BY threads_adult WHERE node_id = ?1 AND is_sticky = 0 AND is_adult = 1 AND merged_into_id IS NULL AND user_id <> ?2 AND (state = 'visible' OR (state = 'moderated' AND ?3 = 1) OR (state = 'deleted' AND ?4 = 1))",
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
export function checkNodePostingRules(ctx: Ctx, actor: Actor, nodeId: number): NodeRow {
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
  function contentRule(
    ctx: Ctx,
    actor: Actor,
    canOpen?: (nodeId: number) => boolean,
    options: AdultOption = {},
  ): ContentRule {
    const permissions = permissionsOf(ctx, actor, options);
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
    return Object.assign(rule, { gates: readGates(ctx, actor, options) });
  },
);
/**
 * A thread that was not merged away, in an open forum, in a state the viewer may see, that the
 * viewer started or may open (`forum.viewOthers`), and that its +18 mark does not keep from them.
 */
export function threadReadable(rule: ContentRule, thread: ThreadRow): boolean {
  return threadOpens(rule, thread) && !rule.gates.hidesAdult(thread);
}
function threadOpens(rule: ContentRule, thread: ThreadRow): boolean {
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
/**
 * A thread as the viewer may reach it: not found unless it would open to them, and with the +18
 * refusal they get when it would open but for its mark or its forum's (`refusal`). The rule then
 * answers as if nothing were marked, so the refusal is told only of content that exists and is
 * otherwise visible to the viewer, never of a deleted or held thread.
 */
function threadAccess(ctx: Ctx, actor: Actor, id: number) {
  const row = threadRow(ctx, id, actorUserId(actor) ?? 0);
  if (!row || row.merged_into_id != null) throw new NotFoundError();
  let refusal: AdultContentError | null = null;
  let node: NodeTreeEntry;
  try {
    node = requireNode(ctx, actor, row.node_id).node;
  } catch (error) {
    if (!(error instanceof AdultContentError)) throw error;
    refusal = error;
    node = getNodeTree(ctx).get(row.node_id)!;
  }
  // The forum is open to the caller; the rest is the shared rule.
  const rule = contentRule(ctx, actor, () => true, { ignoreAdult: refusal !== null });
  if (!threadOpens(rule, row)) throw new NotFoundError();
  // A thread started by a member in a block with the viewer is not there for them.
  if (blockedAmong(ctx, actor, [row.user_id]).size > 0) throw new NotFoundError();
  if (!refusal && rule.gates.hidesAdult(row)) refusal = new AdultContentError(rule.gates.adult()!);
  return { row, node, rule, refusal };
}
export function requireThread(ctx: Ctx, actor: Actor, id: number) {
  const { row, node, refusal } = threadAccess(ctx, actor, id);
  // A thread the viewer would see but for its +18 mark: the +18 page, not the thread.
  if (refusal) throw refusal;
  return { row, node };
}
export function requirePost(ctx: Ctx, actor: Actor, id: number, withBody = false) {
  const post = postRow(ctx, id, withBody);
  if (!post) throw new NotFoundError();
  const access = threadAccess(ctx, actor, post.thread_id);
  // A post the viewer could not see in an open thread is not found, +18 or not.
  if (!access.rule(access.row.node_id, post.state, post.user_id)) throw new NotFoundError();
  if (blockedAmong(ctx, actor, [post.user_id]).size > 0) throw new NotFoundError();
  if (access.refusal) throw access.refusal;
  const thread = { row: access.row, node: access.node };
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
/** Starting a thread marked +18 needs what marking it later needs: the title's permissions. */
function requireAdultMarker(ctx: Ctx, actor: Actor, nodeId: number, userId: number): void {
  if (
    !can(ctx, actor, "forum.editAny", { nodeId }) &&
    !can(ctx, actor, "forum.editOwnThreadTitle", { nodeId, ownerId: userId })
  )
    throw new ForbiddenError();
}
/**
 * Whether the thread's +18 mark was put on by someone other than its author (a moderator): the
 * newest change of the mark in the events, which name the actor only when someone acts on
 * another member's thread. Index seek on the events' target.
 */
function markedByOther(ctx: Ctx, threadId: number): boolean {
  const row = statement<{ actor_id: number | null }, [number]>(
    ctx,
    "newestAdultMark",
    forumSql.newestAdultMark,
  ).get(threadId);
  return row?.actor_id != null;
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
/** The position and guest name of these last posts, in one statement. */
function lastPostsOf(ctx: Ctx, ids: number[]) {
  return new Map(
    ids.length === 0
      ? []
      : statement<{ id: number; position: number; guest_name: string | null }, [string]>(
          ctx,
          "lastPostPositions",
          forumSql.lastPostPositions,
        )
          .all(JSON.stringify(ids))
          .map((r) => [r.id, r] as const),
  );
}
function threadValues(ctx: Ctx, actor: Actor, rows: ThreadRow[]) {
  const lastPosts = lastPostsOf(
    ctx,
    rows.map((r) => r.last_post_id),
  );
  // Where a member in a block with the viewer posted last, the newest post before theirs.
  const seenLast = seenLastPosts(ctx, actor, rows, (r) => lastPosts.get(r.last_post_id)!.position);
  const users = loadUserSummaries(ctx, [
    ...rows.flatMap((r) => [r.user_id, r.last_poster_id]),
    ...[...seenLast.values()].map((post) => post.user_id),
  ]);
  const reads = readRows(
    ctx,
    actor,
    rows.map((r) => r.id),
  );
  const marks = readMarksOf(
    ctx,
    actorUserId(actor),
    rows.map((r) => r.node_id),
  );
  const cutoff = ctx.now() - 30 * 86400000;
  const present = threadPresenter(ctx);
  const gates = readGates(ctx, actor);
  const tree = getNodeTree(ctx);
  // One statement for the page; a poll is shown only where the thread's posts are open.
  const polls = pollKindsOf(
    ctx,
    rows.filter((row) => gates.reads(row.node_id, row.user_id)).map((row) => row.id),
  );
  return rows.map((row) => {
    const read = reads.get(row.id);
    const seen = seenLast.get(row.id);
    const last = seen
      ? { id: seen.id, at: seen.created_at, userId: seen.user_id, position: seen.position }
      : {
          id: row.last_post_id,
          at: row.last_post_at,
          userId: row.last_poster_id,
          position: lastPosts.get(row.last_post_id)!.position,
        };
    const lastGuestName = seen ? seen.guest_name : lastPosts.get(row.last_post_id)?.guest_name;
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
      author: contentAuthor(users, row.user_id, row.guest_name),
      state: row.state,
      isSticky: !!row.is_sticky,
      isLocked: !!row.is_locked,
      createdAt: iso(row.created_at),
      replyCount: row.reply_count,
      viewCount: row.view_count + (ctx.views.get(row.id) ?? 0),
      firstPostId: row.first_post_id,
      lastPost: {
        postId: last.id,
        position: last.position,
        postedAt: iso(last.at),
        user: contentAuthor(users, last.userId, lastGuestName),
      },
      readPosition: read?.last_read_position ?? null,
      isUnread:
        actorUserId(actor) != null &&
        last.at > cutoff &&
        last.at > (marks.get(row.node_id) ?? 0) &&
        last.id > (read?.last_read_post_id ?? 0),
      pollKind: polls.get(row.id) ?? null,
      isAdult: row.is_adult === 1,
      adultByForum: tree.get(row.node_id)?.adult ?? false,
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
  const permissions = permissionsOf(ctx, actor);
  // Who hid a post is for those who may see deleted posts in its forum.
  const deletions = loadDeletions(
    ctx,
    "post",
    entries
      .filter(
        (entry) =>
          entry.row.state === "deleted" &&
          permissions.can("forum.viewDeleted", { nodeId: entry.nodeId }),
      )
      .map((entry) => entry.row.id),
  );
  const users = loadUserSummaries(ctx, [...rows.map((r) => r.user_id), ...deleterIds(deletions)]);
  const reactions = loadViewerReactions(
    ctx,
    actor,
    "post",
    rows.map((r) => r.id),
  );
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
  // Quotes of members in a block with the viewer are taken out of the bodies.
  const bodies = bodiesWithoutBlockedQuotes(ctx, actor, "post", rows);
  return entries.map(({ row, locked, nodeId, firstPostId }) => ({
    id: row.id,
    threadId: row.thread_id,
    position: row.position,
    author: contentAuthor(users, row.user_id, row.guest_name),
    state: row.state,
    createdAt: iso(row.created_at),
    editedAt: isoOrNull(row.edited_at),
    bodyHtml: bodies.get(row.id) ?? row.body_html!,
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
        : !locked &&
          !permissions.can("forum.hardDelete", { nodeId }) &&
          permissions.can("forum.hardDeleteOwn", { nodeId, ownerId: row.user_id })),
    canReact: permissions.can("forum.react", { nodeId }),
    canReport: permissions.can("report.create"),
    deletion: deletionValue(deletions.get(row.id), users, row.user_id),
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
/**
 * Which of these threads (the newest of some forums) a viewer who may not see +18 content must
 * not be shown: the ones marked +18 that are not theirs. Empty, with no query, for anyone else.
 */
function adultLastThreads(ctx: Ctx, actor: Actor, threadIds: number[]): Set<number> {
  if (threadIds.length === 0 || adultRefusalFor(ctx, actor) === null) return new Set();
  return new Set(
    statement<{ id: number }, [string, number]>(
      ctx,
      "adultAmong",
      "SELECT id FROM threads WHERE id IN (SELECT value FROM json_each(?1)) AND is_adult = 1 AND user_id <> ?2",
    )
      .all(JSON.stringify(threadIds), actorUserId(actor) ?? 0)
      .map((row) => row.id),
  );
}
function nodeValues(
  ctx: Ctx,
  actor: Actor,
  ids: number[],
  /** Nodes whose last post the viewer is not shown (+18 nodes on a staff screen). */
  withoutLast: ReadonlySet<number> = new Set(),
) {
  const tree = getNodeTree(ctx);
  const tabs = nodeTabs(ctx);
  const rows = nodeRows(ctx, ids.length === 1 ? ids[0] : undefined);
  const users = loadUserSummaries(
    ctx,
    [...rows.values()].flatMap((r) => (r.last_poster_id == null ? [] : [r.last_poster_id])),
  );
  // A guest's name is on the post itself: read only where a guest posted last.
  const guestLastPosts = lastPostsOf(
    ctx,
    ids.flatMap((id) => {
      const row = rows.get(id)!;
      return row.last_post_id != null && isGuestAuthor(row.last_poster_id!)
        ? [row.last_post_id]
        : [];
    }),
  );
  const permissions = permissionsOf(ctx, actor);
  const gates = readGates(ctx, actor);
  const lastThreads = ids.flatMap((id) => {
    const thread = rows.get(id)!.last_thread_id;
    return thread == null ? [] : [thread];
  });
  const adultLast = adultLastThreads(ctx, actor, lastThreads);
  // A newest post, or its thread, by a member in a block with the viewer is not shown.
  const starters = threadStarters(ctx, lastThreads);
  const blocked = blockedAmong(ctx, actor, [
    ...[...rows.values()].flatMap((r) => (r.last_poster_id == null ? [] : [r.last_poster_id])),
    ...starters.values(),
  ]);
  return ids.map((id) => {
    const { adult: _adult, ...entry } = tree.get(id)!;
    const row = rows.get(id)!;
    const parentAdult = entry.parentId !== null && !!tree.get(entry.parentId)?.adult;
    // The newest post is some member's thread: not shown where others' threads are closed, nor
    // when that thread is marked +18 and the viewer may not see it.
    const lastPost =
      row.last_post_id == null ||
      withoutLast.has(id) ||
      !gates.opensOthers(id) ||
      (row.last_thread_id != null && adultLast.has(row.last_thread_id)) ||
      blocked.has(row.last_poster_id!) ||
      blocked.has(starters.get(row.last_thread_id!) ?? 0)
        ? null
        : {
            postId: row.last_post_id,
            threadId: row.last_thread_id!,
            threadTitle: row.last_thread_title!,
            postedAt: iso(row.last_post_at!),
            user: contentAuthor(
              users,
              row.last_poster_id!,
              guestLastPosts.get(row.last_post_id)?.guest_name,
            ),
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
        countsPosts: !!row.counts_posts,
        minAccountAgeDays: row.min_account_age_days,
        minPostCount: row.min_post_count,
        requirePrefix: !!row.require_prefix,
        isAdult: !!row.is_adult,
      },
      adultByParent: parentAdult,
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

/** Whether the call is a staff management read that sees +18 nodes as forums, not content. */
function managing(ctx: Ctx, actor: Actor, manage: boolean): boolean {
  return manage && can(ctx, actor, "admin.nodes");
}
export const nodesListOp = implement(contracts.nodesList, (ctx, actor, input) => {
  requireSiteView(ctx, actor);
  if (!managing(ctx, actor, input.manage))
    return { items: nodeValues(ctx, actor, viewableNodeIds(ctx, actor)) };
  // The +18 nodes the viewer may not see as content are listed without their last post.
  const content = new Set(viewableNodeIds(ctx, actor));
  const ids = viewableNodeIds(ctx, actor, { ignoreAdult: true });
  return { items: nodeValues(ctx, actor, ids, new Set(ids.filter((id) => !content.has(id)))) };
});
export const nodesGetOp = implement(contracts.nodesGet, (ctx, actor, input) => {
  let node: NodeTreeEntry;
  let withoutLast = new Set<number>();
  try {
    node = requireNode(ctx, actor, input.nodeId).node;
  } catch (error) {
    // The staff edit screen reads a +18 node it may not see as content as a forum to manage.
    if (!(error instanceof AdultContentError) || !managing(ctx, actor, input.manage)) throw error;
    node = getNodeTree(ctx).get(input.nodeId)!;
    withoutLast = new Set([input.nodeId]);
  }
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
    node: nodeValues(ctx, actor, [input.nodeId], withoutLast)[0]!,
    watching: watch ? { mode: watch.mode, email: !!watch.email } : null,
    // A staff read of a +18 node is not a public page: no metadata of its content.
    seo:
      withoutLast.size > 0
        ? {
            title: node.title,
            description: "",
            canonical: canonicalUrl(
              ctx.config.siteBaseURL ?? ctx.config.auth?.baseURL ?? "http://localhost:3000",
              "node",
              node.id,
              node.title,
            ),
            robots: "noindex,follow" as const,
            redirect: false,
            jsonLd: [],
          }
        : seoForNode(ctx, actor, input.nodeId),
    breadcrumbs: getNodeTree(ctx)
      .ancestors(input.nodeId)
      .map(({ id, title, type }) => ({ id, title, type })),
    resolvedPermissions: resolvedPermissions(ctx, actor, { nodeId: input.nodeId }),
  };
});
/**
 * A forum starts or stops counting posts. The counts of the posts already in it follow in a
 * background job; nothing is queued for a node without threads, which no count can depend on. The
 * change is refused while a merge or split involving the forum has not finished (still moving
 * posts, or failed and waiting to be run again), because the chunks still to run would read the
 * new setting for posts counted under the old one. The transfers table is nearly always empty, so
 * the check reads it first rather than every thread of the forum.
 */
function changeNodeCounting(ctx: Ctx, nodeId: number): void {
  if (!forumDb(ctx).prepare("SELECT 1 FROM threads WHERE node_id = ?1 LIMIT 1").get(nodeId)) return;
  if (
    forumDb(ctx)
      .prepare(
        "SELECT 1 FROM thread_transfers x WHERE EXISTS (" +
          "SELECT 1 FROM threads t WHERE t.id = x.thread_id AND t.node_id = ?1) LIMIT 1",
      )
      .get(nodeId)
  )
    throw new ConflictError(
      "A merge or split of threads in this forum has not finished: it is still moving posts, or it failed and must be run again. Try again once it has finished.",
    );
  schedulePostCountRecount(ctx);
}
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
    ["countsPosts", "counts_posts"],
    ["minAccountAgeDays", "min_account_age_days"],
    ["minPostCount", "min_post_count"],
    ["requirePrefix", "require_prefix"],
    ["isAdult", "is_adult"],
  ];
  for (const [key, column] of columns) {
    const value = settings[key];
    if (value === undefined) continue;
    if (key === "countsPosts" && nodeCountsPosts(ctx, nodeId) !== value)
      changeNodeCounting(ctx, nodeId);
    forumDb(ctx)
      .prepare(`UPDATE nodes SET ${column} = ?1 WHERE id = ?2`)
      .run(typeof value === "boolean" ? Number(value) : value, nodeId);
  }
}
/**
 * Replaces the prefixes a forum offers, when the write names them (inside its transaction). A new
 * forum that does not name them offers every active prefix.
 */
function writeNodePrefixes(
  ctx: Ctx,
  nodeId: number,
  type: "category" | "forum",
  prefixIds: readonly number[] | undefined,
  created = false,
): void {
  if (prefixIds === undefined) {
    if (created && type === "forum") offerEveryActivePrefix(ctx, nodeId);
    return;
  }
  if (type !== "forum" && prefixIds.length > 0)
    throw new ValidationError("Only a forum offers thread prefixes.");
  setOfferedPrefixes(ctx, nodeId, prefixIds);
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
    requirePermission(ctx, currentActor(ctx, actor), "admin.nodes");
    if (input.parentId != null && !getNodeTree(ctx).get(input.parentId)) throw new NotFoundError();
    requireNotBeingDeleted(ctx, input.parentId);
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
    writeNodePrefixes(ctx, row.id, input.type, input.prefixIds, true);
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
    requirePermission(ctx, currentActor(ctx, actor), "admin.nodes");
    const tree = getNodeTree(ctx);
    const current = tree.get(input.nodeId);
    if (!current || (input.parentId != null && !tree.get(input.parentId)))
      throw new NotFoundError();
    if (input.parentId != null && tree.subtreeIds(input.nodeId).includes(input.parentId))
      throw new ValidationError("A node cannot be its own descendant.");
    const parentId = input.parentId === undefined ? current.parentId : input.parentId;
    if (parentId !== current.parentId) requireNotBeingDeleted(ctx, parentId);
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
    writeNodePrefixes(ctx, input.nodeId, current.type, input.prefixIds);
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
      requirePermission(ctx, currentActor(ctx, actor), "admin.permissions");
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

type ThreadListFilter = {
  nodeId: number;
  prefixId: number | undefined;
  viewModerated: number;
  viewDeleted: number;
  userId: number;
  own: boolean;
  /** The viewer may not see threads marked +18 (other than their own). */
  hideAdult: boolean;
};
/** The statements of a forum's list for the filter, and the prefix of their prepared keys. */
function listStatements(filter: ThreadListFilter) {
  if (filter.own) return { sql: ownThreadSql, prefix: "own." };
  if (filter.hideAdult) return { sql: adultFreeThreadSql, prefix: "adultFree." };
  return { sql: forumSql, prefix: "" };
}
/**
 * How many non-sticky threads a forum's list holds for the viewer. The plain list is the forum's
 * stored count of visible threads, less its visible sticky ones, plus the held and deleted ones
 * the viewer may see (index ranges of those states, a few rows); a prefix, or a list of only the
 * viewer's own threads, is counted over its own index range.
 */
function threadListTotal(ctx: Ctx, filter: ThreadListFilter): number {
  const { nodeId, prefixId, viewModerated, viewDeleted, userId, own, hideAdult } = filter;
  type Count = { n: number };
  if (own || prefixId !== undefined) {
    const { sql, prefix } = listStatements(filter);
    const key = (name: string) => `${prefix}${name}`;
    return prefixId === undefined
      ? statement<Count, [number, number, number, number]>(
          ctx,
          key("threadCount"),
          sql.threadCount,
        ).get(nodeId, viewModerated, viewDeleted, userId)!.n
      : statement<Count, [number, number, number, number, number]>(
          ctx,
          key("threadCountByPrefix"),
          sql.threadCountByPrefix,
        ).get(nodeId, viewModerated, viewDeleted, userId, prefixId)!.n;
  }
  const hidden = (state: "moderated" | "deleted", all: number) =>
    statement<Count, [number, string, number, number]>(
      ctx,
      "hiddenThreadCount",
      forumSql.hiddenThreadCount,
    ).get(nodeId, state, all, userId)!.n;
  const stored =
    statement<Count, [number]>(ctx, "nodeThreadCount", forumSql.nodeThreadCount).get(nodeId)?.n ??
    0;
  const sticky = statement<Count, [number]>(
    ctx,
    "visibleStickyCount",
    forumSql.visibleStickyCount,
  ).get(nodeId)!.n;
  const adult = hideAdult
    ? statement<Count, [number, number, number, number]>(
        ctx,
        "hiddenAdultCount",
        adultFreeThreadSql.hiddenAdultCount,
      ).get(nodeId, userId, viewModerated, viewDeleted)!.n
    : 0;
  return Math.max(
    0,
    Math.max(0, stored - sticky) +
      hidden("moderated", viewModerated) +
      (viewDeleted ? hidden("deleted", 1) : 0) -
      adult,
  );
}
/**
 * Where a numbered page starts: after the key of the last thread of the page before, the thread at
 * place `offset - 1` from the newest. It is read from whichever end of the list is nearer (the list
 * holds `total` threads), so a positional read walks at most half of the forum's threads.
 */
function threadPageStart(
  ctx: Ctx,
  filter: ThreadListFilter,
  offset: number,
  total: number,
): { sort_at: number; id: number } | null {
  const { nodeId, prefixId, viewModerated, viewDeleted, userId } = filter;
  const fromNewest = offset - 1;
  const fromOldest = total - 1 - fromNewest;
  if (fromOldest < 0) return null;
  const oldest = fromOldest < fromNewest;
  const place = oldest ? fromOldest : fromNewest;
  const { sql, prefix } = listStatements(filter);
  const key = (name: string) => `${prefix}${name}${oldest ? "FromOldest" : ""}`;
  const read = (name: "threadKey" | "threadKeyByPrefix") =>
    oldest ? sql[`${name}FromOldest`] : sql[name];
  type Key = { sort_at: number; id: number };
  return prefixId === undefined
    ? statement<Key, [number, number, number, number, number]>(
        ctx,
        key("threadKey"),
        read("threadKey"),
      ).get(nodeId, viewModerated, viewDeleted, userId, place)
    : statement<Key, [number, number, number, number, number, number]>(
        ctx,
        key("threadKeyByPrefix"),
        read("threadKeyByPrefix"),
      ).get(nodeId, viewModerated, viewDeleted, userId, place, prefixId);
}
export const threadsListOp = implement(contracts.threadsList, (ctx, actor, input) => {
  const { node } = requireNode(ctx, actor, input.nodeId);
  requireSiteView(ctx, actor);
  if (node.type !== "forum") throw new ValidationError("Threads can only be listed in forums.");
  const userId = actorUserId(actor) ?? -1;
  const permissions = permissionsOf(ctx, actor);
  const viewModerated = Number(permissions.can("forum.viewModerated", { nodeId: input.nodeId }));
  const viewDeleted = Number(permissions.can("forum.viewDeleted", { nodeId: input.nodeId }));
  const prefixId = input.prefixId;
  // Where threads of other members are closed to the viewer, only theirs are listed.
  const own = !permissions.can("forum.viewOthers", { nodeId: input.nodeId });
  const hideAdult = adultRefusalFor(ctx, actor) !== null;
  const filter = {
    nodeId: input.nodeId,
    prefixId,
    viewModerated,
    viewDeleted,
    userId,
    own,
    hideAdult,
  };
  // A numbered page past the first starts after the last thread of the page before it.
  const page = input.cursor ? undefined : input.page;
  const offset = page === undefined ? 0 : (page - 1) * input.limit;
  const total = page === undefined ? null : threadListTotal(ctx, filter);
  const start = offset > 0 ? threadPageStart(ctx, filter, offset, total!) : null;
  if (offset > 0 && !start) return { sticky: [], items: [], nextCursor: null, total };
  const cursor = input.cursor
    ? decodeCursor(input.cursor, threadCursor)
    : start
      ? ([start.sort_at, start.id] as const)
      : null;
  const { sql, prefix: keyPrefix } = listStatements(filter);
  const key = (name: string) => `${keyPrefix}${name}`;
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
  const listed = rows.slice(0, input.limit);
  // Threads started by members in a block with the viewer are left out; a page may hold fewer.
  const blocked = blockedAmong(
    ctx,
    actor,
    [...sticky, ...listed].map((thread) => thread.user_id),
  );
  const open = (thread: ThreadRow) => !blocked.has(thread.user_id);
  const shownSticky = sticky.filter(open);
  const values = threadValues(ctx, actor, [...shownSticky, ...listed.filter(open)]);
  const nextCursor =
    rows.length > input.limit ? encodeCursor([listed.at(-1)!.sort_at, listed.at(-1)!.id]) : null;
  return {
    sticky: values.slice(0, shownSticky.length),
    items: values.slice(shownSticky.length),
    nextCursor,
    total,
  };
});
/** Whether the viewer may read a poll of the thread, and whether they may add one. */
function threadPollFacts(
  ctx: Ctx,
  actor: Actor,
  row: ThreadRow,
): { exists: boolean; canAdd: boolean } {
  if (!readGates(ctx, actor).reads(row.node_id, row.user_id))
    return { exists: false, canAdd: false };
  const poll = pollOfThread(ctx, row.id);
  // A poll whose votes are being removed is neither there nor open to a new one.
  if (poll) return { exists: !isRetiring(poll), canAdd: false };
  return { exists: false, canAdd: mayAddPoll(permissionsOf(ctx, actor), actor, row) };
}
export const firstUnreadPostSql =
  "SELECT id, position FROM posts WHERE thread_id = ?1 AND state = 'visible' AND position > ?2 ORDER BY position LIMIT 1";
// The thread an id names now: a merged thread's address goes on to the thread it was merged into.
function mergedThreadId(ctx: Ctx, threadId: number) {
  let targetId = threadId;
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
  return targetId;
}
export const threadsLocateUnreadOp = implement(
  contracts.threadsLocateUnread,
  (ctx, actor, input) => {
    const { row } = requireThread(ctx, actor, mergedThreadId(ctx, input.threadId));
    requireSiteView(ctx, actor);
    const thread = threadValue(ctx, actor, row.id);
    const first =
      thread.isUnread && readGates(ctx, actor).readsOthers(row.node_id)
        ? statement<{ id: number; position: number }, [number, number]>(
            ctx,
            "firstUnreadPost",
            firstUnreadPostSql,
          ).get(
            row.id,
            Math.max(
              thread.readPosition ?? -1,
              positionBeforeMark(
                ctx,
                row.id,
                readMarksOf(ctx, actorUserId(actor), [row.node_id]).get(row.node_id),
              ),
            ),
          )
        : null;
    return first
      ? { threadId: row.id, postId: first.id, position: first.position }
      : { threadId: row.id, postId: thread.lastPost.postId, position: thread.lastPost.position };
  },
);
export const threadsGetOp = implement(contracts.threadsGet, (ctx, actor, input) => {
  const targetId = mergedThreadId(ctx, input.threadId);
  const { row, node } = requireThread(ctx, actor, targetId);
  requireSiteView(ctx, actor);
  // Crawlers read threads too: their visits are not views.
  if (input.countView && !isBotAgent(actor.userAgent))
    ctx.views.set(row.id, (ctx.views.get(row.id) ?? 0) + 1);
  const userId = actorUserId(actor);
  return {
    thread: threadValue(ctx, actor, row.id),
    tags: threadTagNames(ctx, row.id, readGates(ctx, actor).reads(row.node_id, row.user_id)),
    poll: threadPollFacts(ctx, actor, row),
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
      canEditTags: tagRights(ctx, actor, row).remove,
      canModerate: canModerate(ctx, actor, node.id),
      canDelete: row.state !== "deleted" && mayDeleteThread(permissionsOf(ctx, actor), row),
      canLock: mayLockThread(ctx, actor, row, !row.is_locked),
      canHardDelete:
        row.state === "deleted"
          ? can(ctx, actor, "forum.hardDelete", { nodeId: row.node_id })
          : !row.is_locked &&
            !can(ctx, actor, "forum.hardDelete", { nodeId: row.node_id }) &&
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
/**
 * The newest visible post at or before a position of the target of a merge in progress, with the
 * position it ends up at. Stored positions are not the final ones until the merge has flipped
 * them, so the lookup goes by the same slots paging does.
 */
function mergingReadPost(ctx: Ctx, threadId: number, position: number) {
  const state = mergeStateOf(ctx, threadId);
  if (state && state.phase === undefined) {
    const { rows, slots } = mergeSlots(ctx, threadId, state);
    let found: { id: number; position: number } | undefined;
    for (const post of rows) {
      const slot = slots.get(post.id)!;
      if (post.state === "visible" && slot <= position && (!found || slot > found.position))
        found = { id: post.id, position: slot };
    }
    return found;
  }
  return statement<{ id: number; position: number }, [number, number]>(
    ctx,
    "decodedReadPost",
    forumSql.decodedReadPost,
  ).get(threadId, position);
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
  // Posts by members in a block with the viewer are left out; the page may hold fewer.
  const blocked = blockedAmong(
    ctx,
    actor,
    rows.map((post) => post.user_id),
  );
  const shown = blocked.size ? rows.filter((post) => !blocked.has(post.user_id)) : rows;
  return {
    items: postValues(ctx, actor, shown, row.is_locked, row.node_id, row.first_post_id),
    nextCursor: beyond ? encodeCursor([end + 1]) : null,
    ...(anchor === undefined ? {} : { afterPostId: anchor }),
  };
});
export const postsGetOp = implement(contracts.postsGet, (ctx, actor, input) => {
  const { post, thread } = requirePost(ctx, actor, input.postId, true);
  requireSiteView(ctx, actor);
  const value = postValues(
    ctx,
    actor,
    [post],
    thread.row.is_locked,
    thread.row.node_id,
    thread.row.first_post_id,
    true,
  )[0]! as z.infer<typeof contracts.PostDetail>;
  // A post the merge has not renumbered yet is told at the place it will have, as paging does.
  if (thread.row.transfer_role === "merge_target") {
    const slot = ctx.db.transaction(
      () => {
        const state = mergeStateOf(ctx, post.thread_id);
        return state && state.phase === undefined
          ? mergeSlots(ctx, post.thread_id, state).slots.get(post.id)
          : undefined;
      },
      { behavior: "deferred" },
    );
    if (slot !== undefined) value.position = slot;
  }
  return value;
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

export function updateNodeLast(ctx: Ctx, nodeId: number): void {
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
/** Whether visible posts of the forum add to their authors' post counts. */
export function nodeCountsPosts(ctx: Ctx, nodeId: number): boolean {
  return !!statement<{ counts_posts: number }, [number]>(
    ctx,
    "nodeCountsPosts",
    "SELECT counts_posts FROM nodes WHERE id = ?1",
  ).get(nodeId)?.counts_posts;
}
/** Adds delta to the authors of a thread's visible posts, if the forum the thread is in counts them. */
export function adjustThreadAuthors(
  ctx: Ctx,
  threadId: number,
  nodeId: number,
  delta: number,
): void {
  forumDb(ctx).prepare(forumSql.authorAdjustment).run(delta, threadId, nodeId);
}
/**
 * A visible thread's authors after the thread moved between forums: only a counting forum counts,
 * so the counts change when exactly one of the two does (one grouped update, whatever the size).
 */
export function adjustAuthorsForMove(
  ctx: Ctx,
  threadId: number,
  fromNodeId: number,
  toNodeId: number,
): void {
  const delta = Number(nodeCountsPosts(ctx, toNodeId)) - Number(nodeCountsPosts(ctx, fromNodeId));
  if (delta) adjustThreadAuthors(ctx, threadId, delta > 0 ? toNodeId : fromNodeId, delta);
}
export function changeThreadState(ctx: Ctx, id: number, state: State): boolean {
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
    adjustThreadAuthors(ctx, row.id, row.node_id, delta);
    updateNodeLast(ctx, row.node_id);
  }
  return true;
}

/** What starting a thread in a forum needs, before anything of the thread is read. */
function requireThreadStart(ctx: Ctx, actor: Actor, nodeId: number) {
  const { node } = requireNode(ctx, actor, nodeId);
  requirePermission(ctx, actor, "forum.createThread", { nodeId });
  requireTermsAccepted(ctx, actor);
  if (node.type !== "forum") throw new ValidationError("Categories cannot hold threads.");
  checkNodePostingRules(ctx, actor, nodeId);
}

/** What replying in a thread needs, before anything of the reply is read. */
function requireReplyRoom(ctx: Ctx, actor: Actor, threadId: number) {
  const { row } = requireThread(ctx, actor, threadId);
  if (!readGates(ctx, actor).readsOthers(row.node_id)) throw new ForbiddenError(CONTENT_CLOSED);
  requirePermission(ctx, actor, "forum.reply", {
    nodeId: row.node_id,
    threadBanned: !!row.thread_banned,
  });
  if (row.is_locked) requirePermission(ctx, actor, "forum.replyLocked", { nodeId: row.node_id });
  requireTermsAccepted(ctx, actor);
  checkNodePostingRules(ctx, actor, row.node_id);
  return row;
}

// A reply's hashtags link to tags that exist; they never tag the thread or make a tag.
const REPLY_HASHTAGS = { hashtags: { create: false, slots: 0 } };

export const threadsCreateOp = implement(contracts.threadsCreate, (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  requireThreadStart(ctx, actor, input.nodeId);
  if (input.isAdult) requireAdultMarker(ctx, actor, input.nodeId, user.userId);
  if (input.attachmentIds?.length)
    requirePermission(ctx, actor, "forum.uploadAttachments", { nodeId: input.nodeId });
  // The tags listed, then the hashtags of the opening post as far as the cap leaves room.
  const listedTags = tagKeys(input.tags);
  if (listedTags.length > 0) {
    requirePermission(ctx, actor, "tag.apply");
    requireTagCreate(ctx, actor, listedTags);
  }
  const mayCreateTags = can(ctx, actor, "tag.create");
  // A poll or quiz written with the thread: its texts are read and filtered like the post's, and
  // a text a word filter holds for approval holds the thread.
  const poll = input.poll;
  if (poll) {
    requirePermission(ctx, actor, "poll.create", { nodeId: input.nodeId });
    if (
      poll.questions.some(
        (q) => q.imageFileId !== null || q.answers.some((a) => a.imageFileId !== null),
      )
    )
      requirePermission(ctx, actor, "forum.uploadAttachments", { nodeId: input.nodeId });
  }
  const cleanedPoll = poll ? cleanPoll(ctx, actor, poll) : null;
  return withSpamCheck(ctx, actor, input.body, "forum-post", (spam) => {
    const content = prepareModeratedContent(ctx, actor, input.body, true);
    permissionValue(ctx, actor, "mention.maxPerItem");
    const refs = renderModeratedContent(ctx, actor, content, {
      hashtags: hashtagRules(
        ctx,
        actor,
        can(ctx, actor, "tag.apply") ? MAX_THREAD_TAGS - listedTags.length : 0,
      ),
    });
    const html = refs.html;
    const ids = writeTx(ctx, () => {
      const decision = prepareModeratedContent(ctx, actor, input.body, true);
      if (decision.source !== content.source)
        throw new ConflictError("Moderation rules changed; retry.");
      const settings = checkNodePostingRules(ctx, actor, input.nodeId);
      requireWriteRoom(ctx, actor, "thread", decision.floodSeconds);
      if (input.prefixId !== null) requireActivePrefix(ctx, input.prefixId, input.nodeId);
      else requirePrefixChosen(ctx, input.nodeId);
      if (poll && JSON.stringify(cleanPoll(ctx, actor, poll)) !== JSON.stringify(cleanedPoll))
        throw new ConflictError("Moderation rules changed; retry.");
      const state =
        decision.moderated ||
        cleanedPoll?.moderated ||
        spam ||
        (settings.require_thread_approval &&
          !can(ctx, actor, "forum.bypassNodeRules", { nodeId: input.nodeId }))
          ? "moderated"
          : "visible";
      const now = ctx.now();
      const thread = forumDb(ctx)
        .prepare<
          { id: number },
          [number, number, string, string, number, string, number | null, number]
        >(
          "INSERT INTO threads (node_id, user_id, title, state, created_at, last_post_at, last_poster_id, content_updated_at, excerpt, prefix_id, is_adult) VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?2, ?5, ?6, ?7, ?8) RETURNING id",
        )
        .get(
          input.nodeId,
          user.userId,
          input.title,
          state,
          now,
          excerptFromMarkdown(content.source),
          input.prefixId,
          Number(input.isAdult),
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
      addThreadTags(
        ctx,
        thread.id,
        user.userId,
        [
          ...listedTags.map((name) => ({ name, fromPost: false })),
          ...refs.hashtags.map((name) => ({ name, fromPost: true })),
        ],
        mayCreateTags,
      );
      if (cleanedPoll) insertPoll(ctx, user.userId, thread.id, cleanedPoll);
      if (state === "visible") {
        forumDb(ctx)
          .prepare(
            "UPDATE nodes SET thread_count = thread_count + 1, post_count = post_count + 1 WHERE id = ?1",
          )
          .run(input.nodeId);
        updateNodeLast(ctx, input.nodeId);
        if (settings.counts_posts)
          forumDb(ctx)
            .prepare("UPDATE users SET post_count = post_count + 1 WHERE id = ?1")
            .run(user.userId);
      }
      markRead(ctx, user.userId, thread.id, post.id, 0);
      logIp(ctx, actor, "thread", { type: "post", id: post.id });
      // The author's choice of watching is applied here, and the event says it was made, so the
      // watch that follows the author's preference (the social module's) leaves it alone.
      if (input.watch && input.watch !== "none")
        forumDb(ctx)
          .prepare(
            "INSERT INTO thread_watches (user_id, thread_id, email, created_at) VALUES (?1, ?2, ?3, ?4)",
          )
          .run(user.userId, thread.id, Number(input.watch === "watch_email"), now);
      publishEvent(ctx, {
        type: "content.created",
        targetType: "thread",
        targetId: thread.id,
        payload: input.watch ? { watch: input.watch } : undefined,
      });
      publishEvent(ctx, { type: "content.created", targetType: "post", targetId: post.id });
      return { threadId: thread.id, postId: post.id };
    });
    return {
      thread: threadValue(ctx, actor, ids.threadId),
      post: postValue(ctx, actor, ids.postId, true) as z.infer<typeof contracts.PostDetail>,
    };
  });
});
// The composer's Preview: the text rendered as posting it at the target would store it, after the
// checks posting there makes, and nothing written. A thread's hashtags are rendered as the opening
// post's (they may become tags), a reply's and a message's as links to tags that exist.
export const postsPreviewOp = implement(contracts.postsPreview, (ctx, actor, input) => {
  requireAuthenticated(actor);
  const { target } = input;
  let options: Parameters<typeof renderModeratedContent>[3];
  if (target.type === "thread") {
    requireThreadStart(ctx, actor, target.nodeId);
    options = {
      hashtags: hashtagRules(ctx, actor, can(ctx, actor, "tag.apply") ? MAX_THREAD_TAGS : 0),
    };
  } else if (target.type === "reply") {
    requireReplyRoom(ctx, actor, target.threadId);
    options = REPLY_HASHTAGS;
  } else options = requireMessageRoom(ctx, actor, target.conversationId);
  const content = prepareModeratedContent(ctx, actor, input.body, target.type !== "message");
  return { html: renderModeratedContent(ctx, actor, content, options).html };
});

export const postsCreateOp = implement(contracts.postsCreate, (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  const row = requireReplyRoom(ctx, actor, input.threadId);
  if (input.attachmentIds?.length)
    requirePermission(ctx, actor, "forum.uploadAttachments", { nodeId: row.node_id });
  return withSpamCheck(ctx, actor, input.body, "reply", (spam) => {
    const content = prepareModeratedContent(ctx, actor, input.body, true);
    const refs = renderModeratedContent(ctx, actor, content, REPLY_HASHTAGS);
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
        if (settings.counts_posts)
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
// Guests -----------------------------------------------------------------------------------------
// A guest's thread or reply belongs to the reserved guest account and carries the name the guest
// gave. It is always held for approval, so none of a member's follow-ups (counters, read marks,
// watching, the author's alerts and credits) apply until staff approve it.

/** Who wrote removed content, for the moderator log: a member's id, or the name a guest gave. */
function loggedAuthor(row: { user_id: number; guest_name: string | null }) {
  return isGuestAuthor(row.user_id)
    ? { authorId: null, guestName: row.guest_name }
    : { authorId: row.user_id };
}

/** The guest's address, which their limits are counted by; members post under their account. */
function requireGuestPoster(actor: Actor): ClientAddress {
  if (actor.kind !== "guest")
    throw new ForbiddenError("You are signed in: post under your account instead.");
  const address = parseAddress(actor.clientIp);
  if (!address) throw new ValidationError("A client IP is required for guest posting.");
  return address;
}

/**
 * What a forum asks of a guest posting in it: forum.guestPost there, and none of the forum's
 * posting rules, which only an account could meet (read-only, minimum account age or posts).
 */
function requireGuestForum(ctx: Ctx, actor: Actor, nodeId: number): void {
  requirePermission(ctx, actor, "forum.guestPost", { nodeId });
  const settings = nodeRows(ctx, nodeId).get(nodeId);
  if (!settings) throw new NotFoundError();
  if (settings.is_read_only) throw new ForbiddenError("This forum is read-only.");
  if (settings.min_account_age_days || settings.min_post_count)
    throw new ForbiddenError("Only members can post in this forum.");
}

/**
 * The name a guest posts under, cleaned (`cleanGuestName`), which may not pass for a member's: no
 * member's username, nor one kept for erased accounts, in any letter case.
 */
function requireGuestName(ctx: Ctx, raw: string): string {
  const name = cleanGuestName(raw);
  if (name === null) {
    const message =
      "A name is 2 to 50 characters, with no control, invisible or direction characters.";
    throw new ValidationError(message, [{ path: ["name"], message }]);
  }
  const taken =
    isReservedUsername(name) ||
    statement<{ id: number }, [string]>(ctx, "guestNameTaken", forumSql.guestNameTaken).get(
      name.toLowerCase(),
    );
  if (taken) {
    const message = "That name belongs to a member. Choose another one, or sign in.";
    throw new ConflictError(message, [{ path: ["name"], message }]);
  }
  return name;
}

/**
 * Guest posting is open only while Turnstile guards it, and the token must pass. Asked last, after
 * every check the request can fail without it: a token is good for one answer.
 */
async function passGuestTurnstile(
  ctx: Ctx,
  token: string | undefined,
  address: ClientAddress,
): Promise<void> {
  if (!publicTurnstile(ctx)?.forms.includes("guestPost"))
    throw new ForbiddenError("Guests cannot post until the site's security check guards it.");
  try {
    await checkTurnstile(ctx, "guestPost", token, address.ip);
  } catch (error) {
    if (!(error instanceof TurnstileRefusal)) throw error;
    throw new ValidationError(error.message, [
      { path: ["turnstileToken"], message: error.message },
    ]);
  }
}

/** Starting a thread as a guest, before anything of it is written; again inside the transaction. */
function requireGuestThreadStart(ctx: Ctx, actor: Actor, nodeId: number, prefixId: number | null) {
  const { node } = requireNode(ctx, actor, nodeId);
  requireGuestForum(ctx, actor, nodeId);
  if (node.type !== "forum") throw new ValidationError("Categories cannot hold threads.");
  if (prefixId !== null) requireActivePrefix(ctx, prefixId, nodeId);
  else requirePrefixChosen(ctx, nodeId);
}

/** Replying as a guest: a thread the guest can read, in such a forum, and not locked. */
function requireGuestReplyRoom(ctx: Ctx, actor: Actor, threadId: number): ThreadRow {
  const { row } = requireThread(ctx, actor, threadId);
  if (!readGates(ctx, actor).readsOthers(row.node_id)) throw new ForbiddenError(CONTENT_CLOSED);
  requireGuestForum(ctx, actor, row.node_id);
  if (row.is_locked) throw new ForbiddenError("This thread is locked.");
  return row;
}

/** The guest post's address in the IP log, under the guest account: staff see it, limits count it. */
function logGuestIp(ctx: Ctx, actor: Actor, action: "thread" | "post", postId: number): void {
  if (actor.kind !== "guest") return;
  logMemberIp(
    ctx,
    GUEST_ACCOUNT_ID,
    actor.clientIp,
    actor.userAgent,
    action,
    { type: "post", id: postId },
    actor.clientLocation,
  );
}

export const threadsCreateAsGuestOp = implement(
  contracts.threadsCreateAsGuest,
  async (ctx, actor, input) => {
    const address = requireGuestPoster(actor);
    requireGuestThreadStart(ctx, actor, input.nodeId, input.prefixId);
    const name = requireGuestName(ctx, input.name);
    const content = prepareGuestContent(ctx, input.body);
    const refs = renderModeratedContent(ctx, actor, content, {
      hashtags: hashtagRules(ctx, actor, 0),
    });
    await passGuestTurnstile(ctx, input.turnstileToken, address);
    return writeTx(ctx, () => {
      requireGuestThreadStart(ctx, actor, input.nodeId, input.prefixId);
      requireGuestName(ctx, name);
      requireGuestWriteRoom(ctx, actor, address.net, "thread", content.floodSeconds);
      const now = ctx.now();
      const thread = forumDb(ctx)
        .prepare<{ id: number }, [number, number, string, number, string, number | null, string]>(
          "INSERT INTO threads (node_id, user_id, title, state, created_at, last_post_at, last_poster_id, content_updated_at, excerpt, prefix_id, guest_name) VALUES (?1, ?2, ?3, 'moderated', ?4, ?4, ?2, ?4, ?5, ?6, ?7) RETURNING id",
        )
        .get(
          input.nodeId,
          GUEST_ACCOUNT_ID,
          input.title,
          now,
          excerptFromMarkdown(content.source),
          input.prefixId,
          name,
        )!;
      const post = forumDb(ctx)
        .prepare<{ id: number }, [number, number, number, string]>(
          "INSERT INTO posts (thread_id, user_id, position, created_at, guest_name) VALUES (?1, ?2, 0, ?3, ?4) RETURNING id",
        )
        .get(thread.id, GUEST_ACCOUNT_ID, now, name)!;
      forumDb(ctx)
        .prepare(
          "INSERT INTO post_bodies (post_id, body_source, body_html, body_text) VALUES (?1, ?2, ?3, ?4)",
        )
        .run(post.id, refs.source, refs.html, bbCodeText(refs.source));
      storeContentReferences(ctx, "post", post.id, refs);
      storeSpoilers(ctx, "post", post.id, refs.spoilers);
      validateEmbeddedAttachments(ctx, "post", post.id, refs.html);
      forumDb(ctx)
        .prepare("UPDATE threads SET first_post_id = ?1, last_post_id = ?1 WHERE id = ?2")
        .run(post.id, thread.id);
      logGuestIp(ctx, actor, "thread", post.id);
      // `watch: "none"`: nobody's watching preference applies to a guest's thread.
      publishEvent(ctx, {
        type: "content.created",
        targetType: "thread",
        targetId: thread.id,
        payload: { watch: "none" },
      });
      publishEvent(ctx, { type: "content.created", targetType: "post", targetId: post.id });
      return { threadId: thread.id, postId: post.id };
    });
  },
);

export const postsCreateAsGuestOp = implement(
  contracts.postsCreateAsGuest,
  async (ctx, actor, input) => {
    const address = requireGuestPoster(actor);
    const row = requireGuestReplyRoom(ctx, actor, input.threadId);
    const name = requireGuestName(ctx, input.name);
    const content = prepareGuestContent(ctx, input.body);
    const refs = renderModeratedContent(ctx, actor, content, REPLY_HASHTAGS);
    await passGuestTurnstile(ctx, input.turnstileToken, address);
    return writeTx(ctx, () => {
      const current = requireGuestReplyRoom(ctx, actor, row.id);
      if (current.node_id !== row.node_id || current.state !== row.state)
        throw new ConflictError("Thread changed; retry.");
      if (current.transfer_role === "merge_target" || current.transfer_role === "split_target")
        throw new ConflictError(REORGANIZING);
      requireGuestName(ctx, name);
      requireGuestWriteRoom(ctx, actor, address.net, "reply", content.floodSeconds);
      const position =
        (statement<{ position: number }, [number]>(
          ctx,
          "maxPostPosition",
          forumSql.maxPostPosition,
        ).get(row.id)?.position ?? -1) + 1;
      const post = forumDb(ctx)
        .prepare<{ id: number }, [number, number, number, number, string]>(
          "INSERT INTO posts (thread_id, user_id, position, state, created_at, guest_name) VALUES (?1, ?2, ?3, 'moderated', ?4, ?5) RETURNING id",
        )
        .get(row.id, GUEST_ACCOUNT_ID, position, ctx.now(), name)!;
      forumDb(ctx)
        .prepare(
          "INSERT INTO post_bodies (post_id, body_source, body_html, body_text) VALUES (?1, ?2, ?3, ?4)",
        )
        .run(post.id, refs.source, refs.html, bbCodeText(refs.source));
      storeContentReferences(ctx, "post", post.id, refs);
      storeSpoilers(ctx, "post", post.id, refs.spoilers);
      validateEmbeddedAttachments(ctx, "post", post.id, refs.html);
      logGuestIp(ctx, actor, "post", post.id);
      publishEvent(ctx, { type: "content.created", targetType: "post", targetId: post.id });
      return { postId: post.id };
    });
  },
);
export const threadsUpdateOp = implement(contracts.threadsUpdate, (ctx, actor, input) => {
  requireAuthenticated(actor);
  const { row } = requireThread(ctx, actor, input.threadId);
  if (
    input.title === undefined &&
    input.prefixId === undefined &&
    input.tags === undefined &&
    input.isAdult === undefined
  )
    throw new ValidationError("Send a title, a prefix, tags, the +18 mark, or any of them.");
  // The title, prefix and +18 mark are the author's while unlocked; tags the author's or staff's.
  const editsThread =
    input.title !== undefined || input.prefixId !== undefined || input.isAdult !== undefined;
  const wantedTags = input.tags === undefined ? undefined : tagKeys(input.tags);
  if (editsThread && !mayEditTitle(ctx, actor, row)) throw new ForbiddenError();
  if (wantedTags) requireTagChange(ctx, actor, row, wantedTags);
  requireTermsAccepted(ctx, actor);
  writeTx(ctx, () => {
    const moderator = currentActor(ctx, actor);
    const current = requireThread(ctx, moderator, row.id).row;
    if (editsThread && !mayEditTitle(ctx, moderator, current)) throw new ForbiddenError();
    if (wantedTags) {
      requireTagChange(ctx, moderator, current, wantedTags);
      replaceThreadTags(
        ctx,
        row.id,
        actorUserId(actor)!,
        wantedTags,
        can(ctx, moderator, "tag.create"),
        // The tags the opening post's hashtags put there are its text: left as they are for
        // someone who cannot read it, who was never shown them.
        !readGates(ctx, moderator).reads(current.node_id, current.user_id),
      );
    }
    const prefixId = input.prefixId === undefined ? current.prefix_id : input.prefixId;
    if (prefixId !== null && prefixId !== current.prefix_id)
      requireActivePrefix(ctx, prefixId, current.node_id);
    // Taking the prefix off is refused to the author where the forum requires one; a moderator
    // may, and a thread that has none can still be retitled.
    if (
      input.prefixId === null &&
      current.prefix_id !== null &&
      !can(ctx, moderator, "forum.editAny", { nodeId: current.node_id })
    )
      requirePrefixChosen(ctx, current.node_id);
    forumDb(ctx)
      .prepare("UPDATE threads SET prefix_id = ?1, content_updated_at = ?2 WHERE id = ?3")
      .run(prefixId, ctx.now(), row.id);
    if (input.isAdult !== undefined) {
      // A mark someone else put on the thread is theirs to take off, not the author's.
      if (
        !input.isAdult &&
        current.is_adult === 1 &&
        !can(ctx, moderator, "forum.editAny", { nodeId: current.node_id }) &&
        markedByOther(ctx, row.id)
      )
        throw new ForbiddenError("A moderator marked this thread +18; only staff can remove it.");
      forumDb(ctx)
        .prepare("UPDATE threads SET is_adult = ?1 WHERE id = ?2")
        .run(Number(input.isAdult), row.id);
    }
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
      payload: {
        ...moderationPayload(actor, row.user_id, input),
        ...(input.isAdult === undefined ? {} : { isAdult: input.isAdult }),
      },
    });
    if (
      can(ctx, moderator, "forum.editAny", { nodeId: current.node_id }) ||
      (wantedTags && row.user_id !== actorUserId(actor))
    )
      appendModeratorLog(
        ctx,
        actor,
        "thread.update",
        "thread",
        row.id,
        input.reason,
        {
          ...(input.prefixId === undefined ? {} : { prefixId: input.prefixId }),
          ...(wantedTags ? { tags: wantedTags } : {}),
          ...(input.isAdult === undefined ? {} : { isAdult: input.isAdult }),
        },
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
  // The opening post's hashtags are its thread's tags, for those who may set them.
  const tagsFollowPost = post.id === thread.row.first_post_id && mayTag(ctx, actor, thread.row);
  const refs = renderModeratedContent(ctx, actor, content, {
    edit: { contentType: "post", contentId: post.id, authorId: post.user_id },
    hashtags: tagsFollowPost
      ? hashtagRules(ctx, actor, MAX_THREAD_TAGS - manualTagCount(ctx, thread.row.id))
      : { create: false, slots: 0 },
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
    // An edit held for approval puts no tag on the thread; the text of the post is not yet public.
    if (tagsFollowPost && !decision.moderated && mayTag(ctx, moderator, now.thread.row))
      syncPostTags(
        ctx,
        now.thread.row.id,
        post.user_id,
        refs.hashtags,
        can(ctx, moderator, "tag.create"),
      );
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
 * author unlocks only a lock they put on themselves: the newest lock event of the thread names
 * no one else (a lock staff set, or one that left no such event, stays).
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
    .prepare<{ actor_id: number | null; locked: number | null }, [number]>(forumSql.newestLock)
    .get(row.id);
  return newest?.locked === 1 && newest.actor_id === null;
}
/**
 * Staff locking a thread that is already locked by its author makes the lock theirs: the lock
 * event is published again, naming them, so the author can no longer lift it. Nothing else
 * changes, nobody is told. The caller has authorized the lock.
 */
export const takeOverLock = markPublic(
  "The caller has authorized the lock; this only records whose it is.",
  function takeOverLock(ctx: Ctx, actor: Actor, row: { id: number; user_id: number }, reason = "") {
    if (actorUserId(actor) === row.user_id) return;
    const newest = forumDb(ctx)
      .prepare<{ actor_id: number | null; locked: number | null }, [number]>(forumSql.newestLock)
      .get(row.id);
    if (newest?.locked === 1 && newest.actor_id === null)
      publishEvent(ctx, {
        type: "content.edited",
        targetType: "thread",
        targetId: row.id,
        payload: { isLocked: true, actorId: actorUserId(actor), reason, notify: false },
      });
  },
);
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
  if (isLocked && current.is_locked) takeOverLock(ctx, moderator, current, notice.reason);
  if (!!current.is_locked !== isLocked)
    publishEvent(ctx, {
      type: "content.edited",
      targetType: "thread",
      targetId: id,
      payload: { isLocked, ...moderationPayload(moderator, current.user_id, notice) },
    });
  // A moderator action is logged; an author's own lock is not (the log counts as moderator actions).
  if (can(ctx, moderator, "forum.lock", { nodeId: current.node_id }))
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
/**
 * Whether a thread's content is +18 where it is now: its own mark or its forum's. Moving, merging
 * and splitting never take +18 content out of the mark: the thread that ends up holding it carries
 * the mark as its own (a moderator may take it off afterwards).
 */
function effectivelyAdult(ctx: Ctx, row: Pick<ThreadRow, "is_adult" | "node_id">): boolean {
  if (row.is_adult === 1) return true;
  // Inside the write transaction the tree is built afresh: ask first whether any node is marked.
  if (!statement<{ n: number }, []>(ctx, "anyAdultNode", forumSql.anyAdultNode).get()) return false;
  return !!getNodeTree(ctx).get(row.node_id)?.adult;
}
function carryAdultMark(ctx: Ctx, threadId: number): void {
  forumDb(ctx).prepare("UPDATE threads SET is_adult = 1 WHERE id = ?1").run(threadId);
}
/**
 * Records that a moderator's merge or split left a thread marked +18: the same change of the mark
 * an edit records, with the moderator as its actor, so the thread's author cannot take it off.
 */
function recordCarriedMark(
  ctx: Ctx,
  moderator: Actor,
  threadId: number,
  ownerId: number,
  notice: Notice,
): void {
  publishEvent(ctx, {
    type: "content.edited",
    targetType: "thread",
    targetId: threadId,
    payload: { ...moderationPayload(moderator, ownerId, notice), isAdult: true },
  });
}
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
  // A thread leaving a +18 forum stays +18 by its own mark.
  const carried = current.is_adult === 0 && effectivelyAdult(ctx, current);
  if (carried) carryAdultMark(ctx, id);
  // As XenForo does, a prefix the new forum does not offer is dropped.
  forumDb(ctx)
    .prepare(
      "UPDATE threads SET prefix_id = NULL WHERE id = ?1 AND prefix_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM forum_prefixes WHERE node_id = ?2 AND prefix_id = threads.prefix_id)",
    )
    .run(id, nodeId);
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
    adjustAuthorsForMove(ctx, id, current.node_id, nodeId);
    updateNodeLast(ctx, current.node_id);
    updateNodeLast(ctx, nodeId);
  }
  publishEvent(ctx, {
    type: "content.edited",
    targetType: "thread",
    targetId: id,
    payload: {
      ...moderationPayload(moderator, current.user_id, notice),
      ...(carried ? { isAdult: true } : {}),
    },
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
      if (nodeCountsPosts(ctx, thread.node_id))
        forumDb(ctx)
          .prepare("UPDATE users SET post_count = max(0, post_count + ?1) WHERE id = ?2")
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
  // The places of a merge target's posts are worked out before the write lock is taken: they do
  // not change while the merge runs.
  const merging = row.transfer_role === "merge_target";
  const placed = merging
    ? ctx.db.transaction(() => mergingReadPost(ctx, row.id, input.position), {
        behavior: "deferred",
      })
    : undefined;
  return writeTx(ctx, () => {
    const post = merging
      ? placed
      : forumDb(ctx)
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
  /** Read by a split: the new thread's author is its first post's, a guest's name included. */
  guest_name?: string | null;
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
    const userDelta =
      Number(target.state === "visible" && nodeCountsPosts(ctx, target.node_id)) -
      Number(sourceVisible && nodeCountsPosts(ctx, source.node_id));
    if (userDelta) {
      const adjust = forumDb(ctx).prepare(
        "UPDATE users SET post_count = max(0, post_count + ?1) WHERE id = ?2",
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
  registerNodeDeleteJob(ctx);
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
  const userDelta =
    Number(target.state === "visible" && nodeCountsPosts(ctx, target.node_id)) -
    Number(source.state === "visible" && nodeCountsPosts(ctx, source.node_id));
  if (userDelta) {
    const authors = new Map<number, number>();
    for (const post of visible) authors.set(post.user_id, (authors.get(post.user_id) ?? 0) + 1);
    const adjust = forumDb(ctx).prepare(
      "UPDATE users SET post_count = max(0, post_count + ?1) WHERE id = ?2",
    );
    for (const [userId, count] of authors) adjust.run(count * userDelta, userId);
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
          "SELECT id, position, user_id, state, created_at, guest_name FROM posts WHERE thread_id = ?1 AND id IN (SELECT value FROM json_each(?2)) ORDER BY position",
        ).all(source.id, JSON.stringify(input.postIds))
      : statement<TransferPost, [number, number, number]>(
          ctx,
          "splitRange",
          "SELECT id, position, user_id, state, created_at, guest_name FROM posts WHERE thread_id = ?1 AND position >= ?2 ORDER BY position LIMIT ?3",
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
      .prepare<
        { id: number },
        [number, number, string, State, number, string, string | null, number]
      >(
        "INSERT INTO threads (node_id, user_id, title, state, created_at, last_post_at, last_poster_id, content_updated_at, excerpt, guest_name, is_adult) VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?2, ?5, ?6, ?7, ?8) RETURNING id",
      )
      .get(
        input.nodeId,
        first.user_id,
        input.title,
        source.state,
        first.created_at ?? ctx.now(),
        excerptFromMarkdown(body.body_source),
        first.guest_name ?? null,
        // Posts split out of +18 content stay +18.
        Number(effectivelyAdult(ctx, current)),
      )!;
    if (effectivelyAdult(ctx, current))
      recordCarriedMark(ctx, actor, target.id, first.user_id, input);
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
    // Posts merged out of +18 content keep it +18: the target carries the mark.
    if (
      !effectivelyAdult(ctx, currentTarget) &&
      input.sourceThreadIds.some((id) => {
        const source = threadRow(ctx, id);
        return source !== undefined && effectivelyAdult(ctx, source);
      })
    ) {
      carryAdultMark(ctx, target.id);
      recordCarriedMark(ctx, actor, target.id, currentTarget.user_id, input);
    }
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
      moveThreadTags(ctx, source.id, target.id);
      movePoll(ctx, source.id, target.id);
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
  if (prefixId !== null) requireActivePrefix(ctx, prefixId, current.node_id);
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
  // Whoever holds forum.hardDelete is staff here, author or not: the two-step rule is theirs.
  if (can(ctx, actor, "forum.hardDelete", { nodeId: row.node_id })) return "staff";
  if (!row.is_locked && can(ctx, actor, "forum.hardDeleteOwn", { nodeId: row.node_id, ownerId })) {
    if (state === "deleted")
      throw new ConflictError("Content that was hidden by staff cannot be deleted by its author.");
    return "own";
  }
  throw new ForbiddenError();
}

/**
 * A warning given about a post (`warnings.create` with a `postId`) is recorded only in the
 * moderator log, as a `warning.add` entry on the member with the post in its details: the member
 * does not delete the post it was given for. One seek on the log's target index, which holds
 * the member's entries only.
 */
function requireNotWarnedAbout(ctx: Ctx, userId: number, postIds: number[]): void {
  const warned = forumDb(ctx)
    .prepare<{ n: number }, [number, string]>(forumSql.warnedAbout)
    .get(userId, JSON.stringify(postIds));
  if (warned)
    throw new ConflictError("A warning was given about this. Hide it, or ask staff to delete it.");
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

/**
 * The next posts of a thread being deleted for good, newest first with the opening post left for
 * the end: up to `limit`, and one more when there are more, which tells the caller to come back.
 */
export function threadPostsToPurge(
  ctx: Ctx,
  thread: Pick<ThreadRow, "id" | "first_post_id">,
  limit: number,
) {
  return forumDb(ctx)
    .prepare<{ id: number; state: State; user_id: number }, [number, number, number]>(
      "SELECT id, state, user_id FROM posts WHERE thread_id = ?1 AND id != ?2 ORDER BY position DESC, id DESC LIMIT ?3",
    )
    .all(thread.id, thread.first_post_id ?? 0, limit + 1);
}
/**
 * Removes `chunk`, posts `threadPostsToPurge` returned for the thread, and the opening post and the
 * thread itself with the last of them (`more` false). Returns how many posts went. Callers
 * authorize and have hidden the thread. A thread that stays keeps its own figures true for the
 * staff who can still open it.
 */
export function purgeThreadChunk(
  ctx: Ctx,
  thread: Pick<ThreadRow, "id" | "first_post_id">,
  chunk: { id: number; state: State }[],
  more: boolean,
): number {
  const ids = chunk.map((post) => post.id);
  if (!more && thread.first_post_id) ids.push(thread.first_post_id);
  purgeContent(ctx, "post", ids);
  if (more) {
    const visibleGone = chunk.filter((post) => post.state === "visible").length;
    forumDb(ctx)
      .prepare("UPDATE threads SET reply_count = max(0, reply_count - ?1) WHERE id = ?2")
      .run(visibleGone, thread.id);
    settleThreadAfterPurge(ctx, thread.id, thread.first_post_id);
  } else {
    purgeThread(ctx, thread.id);
  }
  return ids.length;
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
    // A poll with more voters than one transaction should remove is taken out by a job (it is hidden
    // now and removed batch by batch): the thread stays, deleted, and nothing else is removed until
    // the poll is gone; a call meanwhile only finds the job there.
    const largePoll = pollNeedingBatches(ctx, current.id);
    if (largePoll !== null) {
      if (path === "own")
        throw new ConflictError(
          "The poll of this thread has too many votes to delete in one step. Hide the thread, or ask staff to delete it.",
        );
      retirePoll(ctx, largePoll);
      enqueuePollPurge(ctx, largePoll);

      appendModeratorLog(
        ctx,
        actor,
        "thread.hardDelete",
        "thread",
        current.id,
        input.reason,
        {
          title: current.title,
          // Staff who may not see +18 content are not shown the title of a +18 thread.
          ...(effectivelyAdult(ctx, current) ? { adult: true } : {}),
          ...loggedAuthor(current),
          removedPosts: 0,
          completed: false,
        },
        current.node_id,
      );
      return { completed: false, removedPosts: 0 };
    }
    const found = threadPostsToPurge(ctx, current, PURGE_CHUNK);
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
          "This thread holds hidden posts. Hide the thread, or ask staff to delete it.",
        );
      const posts = [
        ...found.map((post) => post.id),
        ...(current.first_post_id ? [current.first_post_id] : []),
      ];
      requireNotWarnedAbout(ctx, current.user_id, posts);
      requireNotReported(ctx, posts, current.id);
    }
    const removedPosts = purgeThreadChunk(ctx, current, found.slice(0, PURGE_CHUNK), more);
    // The title and author stay in the log: the thread itself will not. An author's own delete
    // is not a moderator action and is not logged.
    if (path === "staff")
      appendModeratorLog(
        ctx,
        actor,
        "thread.hardDelete",
        "thread",
        current.id,
        input.reason,
        {
          title: current.title,
          // Staff who may not see +18 content are not shown the title of a +18 thread.
          ...(effectivelyAdult(ctx, current) ? { adult: true } : {}),
          ...loggedAuthor(current),
          removedPosts,
          completed: !more,
        },
        current.node_id,
      );
    return { completed: !more, removedPosts };
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
      requireNotWarnedAbout(ctx, current.post.user_id, [current.post.id]);
      requireNotReported(ctx, [current.post.id]);
      changePostState(ctx, current.post.id, "deleted");
    }
    purgeContent(ctx, "post", [post.id]);
    settleThreadAfterPurge(ctx, current.thread.row.id, current.thread.row.first_post_id);
    if (path === "staff")
      appendModeratorLog(
        ctx,
        actor,
        "post.hardDelete",
        "post",
        post.id,
        input.reason,
        { threadId: current.thread.row.id, ...loggedAuthor(post) },
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
  nodesDeleteOp,
  nodesSetModeratorOp,
  threadsListOp,
  threadsGetOp,
  threadsLocateUnreadOp,
  threadsCreateOp,
  threadsCreateAsGuestOp,
  postsPreviewOp,
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
  nodesMarkReadOp,
  nodesMarkAllReadOp,
  nodesUnreadOp,
  threadsMergeOp,
  threadsSplitOp,
  postsListOp,
  postsGetOp,
  postsCreateOp,
  postsCreateAsGuestOp,
  postsUpdateOp,
  postsDeleteOp,
  postsRestoreOp,
  postsHardDeleteOp,
  ...forumPrefixOperations,
];
