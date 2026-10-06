import type { SQLQueryBindings } from "bun:sqlite";
import * as z from "zod";
import type { Actor } from "../../actor";
import { actorUserId, requireAuthenticated } from "../../actor";
import { type Ctx, prepared } from "../../context";
import * as contracts from "../../contracts/moderation";
import type { ContentStateValue } from "../../db/schema";
import { writeTx } from "../../db/tx";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { publishEvent } from "../../events";
import { implement, markPublic } from "../../operation";
import { decodeCursor, encodeCursor } from "../../pagination";
import {
  can,
  currentVersions,
  type FlagPermissionId,
  memberActor,
  PRINCIPAL_COLUMNS,
  type PrincipalRow,
  permissionsOf,
  requirePermission,
} from "../../permissions";
import { iso } from "../../time";
import { revokeUserCredentials } from "../auth";
import { forumSql } from "../forums";
import { enqueueJob, registerJobHandler } from "../jobs";
import { readSiteSettings } from "../settings";

export type { SpamChecker, SpamFetch, SpamSubmission, SpamVerdict } from "./spam";
export { akismetChecker, disabledSpamChecker, stopForumSpamChecker } from "./spam";

/** Optional external verdict, obtained before the synchronous content transaction. */
export const checkContentSpam = markPublic(
  "Content callers authorize submissions before spam checks.",
  async function checkContentSpam(
    ctx: Ctx,
    actor: Actor,
    body: string,
    kind: "forum-post" | "reply" | "message",
  ): Promise<boolean> {
    const checker = ctx.config.spamChecker;
    if (!checker) return false;
    const user = requireAuthenticated(actor);
    if (!user.clientIp) throw new ValidationError("A client IP is required for spam checks.");
    const identity = ctx.sqlite
      .prepare<{ username: string; email: string }, [number]>(
        "SELECT u.username, a.email FROM users u JOIN auth_user a ON a.id = u.id WHERE u.id = ?1",
      )
      .get(user.userId);
    if (!identity) throw new NotFoundError();
    const verdict = await checker.check({
      ip: user.clientIp,
      username: identity.username,
      email: identity.email,
      body,
      kind,
    });
    return verdict.spam;
  },
);

export const withSpamCheck = markPublic(
  "Content callers authorize submissions before spam checks.",
  function withSpamCheck<T>(
    ctx: Ctx,
    actor: Actor,
    body: string,
    kind: "forum-post" | "reply" | "message",
    write: (spam: boolean) => T,
  ): T | Promise<T> {
    if (!ctx.config.spamChecker) return write(false);
    return checkContentSpam(ctx, actor, body, kind).then(write);
  },
);

export type TargetType =
  | "post"
  | "profile_post"
  | "profile_post_comment"
  | "conversation_message"
  | "user";
export type ContentType = Exclude<TargetType, "user"> | "thread";
type Target = { type: TargetType; id: number };
type Content = { type: ContentType; id: number };
type Row = {
  id: number;
  user_id: number;
  state: ContentStateValue;
  node_id?: number;
  thread_id?: number;
  profile_post_id?: number;
  profile_user_id?: number;
  conversation_id?: number;
  first_post_id?: number;
  reply_count?: number;
  is_locked?: number;
  created_at?: number;
};
type ReportGroup = {
  id: number;
  target_type: TargetType;
  target_id: number;
  state: string;
  assigned_to_id: number | null;
  report_count: number;
  created_at: number;
  updated_at: number;
  resolved_at: number | null;
};
type QueueTarget = {
  type: ContentType | "user";
  id: number;
  node_id?: number | null;
  conversation_id?: number | null;
  target_exists?: number | null;
};

function filterModeratable<T extends QueueTarget>(
  ctx: Ctx,
  actor: Actor,
  rows: T[],
  queue: "reports" | "approvals",
): T[] {
  const grants = permissionsOf(ctx, actor);
  return rows.filter((row) => {
    if (row.target_exists === null) return false;
    if (row.type === "thread" || row.type === "post")
      return (
        row.node_id != null &&
        grants.can(queue === "reports" ? "forum.manageReports" : "forum.approve", {
          nodeId: row.node_id,
        })
      );
    if (row.type === "conversation_message")
      return row.conversation_id != null && grants.can("conversation.moderate");
    return grants.can(
      queue === "reports" || row.type === "user" ? "report.manageProfiles" : "profilePost.approve",
    );
  });
}

function query<T>(ctx: Ctx, key: string, sql: string) {
  return prepared(ctx, `moderation.${key}`, () => ctx.sqlite.prepare<T, SQLQueryBindings[]>(sql));
}
function read<T>(
  ctx: Ctx,
  key: string,
  sql: string,
  ...args: (SQLQueryBindings | undefined)[]
): T | undefined {
  return query<T>(ctx, key, sql).get(...args.map((arg) => arg ?? null)) ?? undefined;
}
function exec(ctx: Ctx, key: string, sql: string, ...args: (SQLQueryBindings | undefined)[]) {
  return query(ctx, key, sql).run(...args.map((arg) => arg ?? null));
}
function requireGlobal(ctx: Ctx, actor: Actor, id: FlagPermissionId): number {
  const user = requireAuthenticated(actor);
  requirePermission(ctx, actor, id);
  return user.userId;
}
function principalMember(ctx: Ctx, userId: number): Actor {
  const row = read<PrincipalRow & { id: number; group_id: number }>(
    ctx,
    "principalMember",
    `SELECT u.id, u.group_id, ${PRINCIPAL_COLUMNS} FROM users u WHERE u.id = ?1`,
    userId,
  );
  if (!row) throw new NotFoundError();
  return memberActor(row.id, row.group_id, row, currentVersions(ctx));
}
function targetRow(ctx: Ctx, target: Target | Content): Row {
  const { type, id } = target;
  const sql = {
    thread: "SELECT * FROM threads WHERE id = ?1",
    post: "SELECT p.*, t.node_id, t.state AS thread_state, t.first_post_id FROM posts p JOIN threads t ON t.id = p.thread_id WHERE p.id = ?1",
    profile_post: "SELECT * FROM profile_posts WHERE id = ?1",
    profile_post_comment:
      "SELECT c.*, p.profile_user_id, p.state AS parent_state FROM profile_post_comments c JOIN profile_posts p ON p.id = c.profile_post_id WHERE c.id = ?1",
    conversation_message: "SELECT * FROM conversation_messages WHERE id = ?1",
    user: "SELECT id, id AS user_id, 'visible' AS state FROM users WHERE id = ?1",
  }[type];
  const row = read<Row>(ctx, `target.${type}`, sql, id);
  if (!row) throw new NotFoundError();
  return row;
}
function visibleTarget(ctx: Ctx, actor: Actor, target: Target): Row {
  const row = targetRow(ctx, target);
  const viewer = actorUserId(actor);
  if (target.type === "post") {
    const thread = read<{ state: ContentStateValue; user_id: number }>(
      ctx,
      "threadVisibility",
      "SELECT state, user_id FROM threads WHERE id = ?1",
      row.thread_id,
    );
    const grants = permissionsOf(ctx, actor);
    const visible = (state: ContentStateValue, ownerId: number) =>
      state === "visible" ||
      (state === "moderated"
        ? ownerId === viewer || grants.can("forum.viewModerated", { nodeId: row.node_id! })
        : grants.can("forum.viewDeleted", { nodeId: row.node_id! }));
    if (
      !grants.can("node.view", { nodeId: row.node_id! }) ||
      !thread ||
      !visible(thread.state, thread.user_id)
    )
      throw new NotFoundError();
    if (!visible(row.state, row.user_id)) throw new NotFoundError();
  } else if (target.type === "profile_post" || target.type === "profile_post_comment") {
    const grants = permissionsOf(ctx, actor);
    if (!grants.can("profile.view")) throw new NotFoundError();
    const visible = (state: ContentStateValue, ownerId: number) =>
      state === "visible" ||
      (state === "moderated"
        ? ownerId === viewer || grants.can("profilePost.viewModerated")
        : grants.can("profilePost.viewDeleted"));
    if (target.type === "profile_post_comment") {
      const parent = targetRow(ctx, { type: "profile_post", id: row.profile_post_id! });
      if (!visible(parent.state, parent.user_id)) throw new NotFoundError();
    }
    if (!visible(row.state, row.user_id)) throw new NotFoundError();
  } else if (target.type === "conversation_message") {
    if (
      viewer == null ||
      !read(
        ctx,
        "activeParticipant",
        "SELECT id FROM conversation_participants WHERE conversation_id = ?1 AND user_id = ?2 AND state = 'active'",
        row.conversation_id,
        viewer,
      )
    )
      throw new NotFoundError();
    if (row.state !== "visible" && row.user_id !== viewer) throw new NotFoundError();
  }
  if (target.type === "user" && !can(ctx, actor, "profile.view")) throw new NotFoundError();
  return row;
}
type ContentAction =
  | "report"
  | "delete"
  | "restore"
  | "approve"
  | "edit"
  | "history"
  | "move"
  | "lock";
function requireContentModerator(
  ctx: Ctx,
  actor: Actor,
  target: Content | Target,
  action: ContentAction,
  row = targetRow(ctx, target),
): Row {
  if (target.type === "user") {
    requirePermission(ctx, actor, "report.manageProfiles");
  } else if (target.type === "post" || target.type === "thread") {
    const id =
      action === "report"
        ? "forum.manageReports"
        : action === "delete"
          ? "forum.deleteAny"
          : action === "restore"
            ? "forum.undelete"
            : action === "approve"
              ? "forum.approve"
              : action === "edit"
                ? "forum.editAny"
                : action === "history"
                  ? "forum.viewHistory"
                  : action === "move"
                    ? "forum.move"
                    : "forum.lock";
    requirePermission(ctx, actor, id, { nodeId: row.node_id! }, { notFound: true });
  } else if (target.type === "conversation_message") {
    requirePermission(ctx, actor, "conversation.moderate");
  } else {
    const id =
      action === "report"
        ? "report.manageProfiles"
        : action === "delete"
          ? "profilePost.deleteAny"
          : action === "restore"
            ? "profilePost.undelete"
            : action === "approve"
              ? "profilePost.approve"
              : "profilePost.editAny";
    requirePermission(ctx, actor, id);
  }
  return row;
}

/** Append within the caller's write transaction. This function never updates or deletes log rows. */
export const appendModeratorLog = markPublic(
  "Callers authorize the action before writing its audit entry.",
  function appendModeratorLog(
    ctx: Ctx,
    actor: Actor,
    action: string,
    targetType: string,
    targetId: number,
    reason = "",
    details: Record<string, unknown> = {},
  ): number {
    const actorId = requireAuthenticated(actor).userId;
    return Number(
      exec(
        ctx,
        "logInsert",
        "INSERT INTO moderator_log (actor_id, action, target_type, target_id, reason, details, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        actorId,
        action,
        targetType,
        targetId,
        reason,
        JSON.stringify(details),
        ctx.now(),
      ).lastInsertRowid,
    );
  },
);

export function createReport(ctx: Ctx, actor: Actor, target: Target, reason: string) {
  const userId = requireAuthenticated(actor).userId;
  if (!reason.trim()) throw new ValidationError("A report reason is required.");
  requirePermission(ctx, actor, "report.create");
  visibleTarget(ctx, actor, target);
  return writeTx(ctx, () => {
    visibleTarget(ctx, actor, target);
    const now = ctx.now();
    exec(
      ctx,
      "groupUpsert",
      "INSERT INTO report_groups (target_type, target_id, state, report_count, created_at, updated_at) VALUES (?1, ?2, 'open', 0, ?3, ?3) ON CONFLICT(target_type, target_id) DO UPDATE SET state = 'open', assigned_to_id = NULL, resolved_at = NULL, updated_at = excluded.updated_at",
      target.type,
      target.id,
      now,
    );
    const group = read<ReportGroup>(
      ctx,
      "groupTarget",
      "SELECT * FROM report_groups WHERE target_type = ?1 AND target_id = ?2",
      target.type,
      target.id,
    )!;
    const id = Number(
      exec(
        ctx,
        "reportInsert",
        "INSERT INTO reports (group_id, reporter_id, reason, created_at) VALUES (?1, ?2, ?3, ?4)",
        group.id,
        userId,
        reason.trim(),
        now,
      ).lastInsertRowid,
    );
    exec(
      ctx,
      "reportCount",
      "UPDATE report_groups SET report_count = report_count + 1 WHERE id = ?1",
      group.id,
    );
    return { id, groupId: group.id };
  });
}

export function listReports(
  ctx: Ctx,
  actor: Actor,
  input: {
    state?: "open" | "assigned" | "resolved" | "rejected";
    cursor?: string | null;
    limit?: number;
  } = {},
) {
  requireAuthenticated(actor);
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const [at, id] = input.cursor
    ? decodeCursor(input.cursor, z.tuple([z.number().int(), z.number().int()]))
    : [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
  const rows = query<
    ReportGroup & {
      type: TargetType;
      node_id: number | null;
      conversation_id: number | null;
      target_exists: number | null;
    }
  >(
    ctx,
    "reportQueue",
    "SELECT g.*, g.target_type AS type, pt.node_id, cm.conversation_id, coalesce(p.id, pp.id, pc.id, cm.id, u.id) AS target_exists FROM report_groups g LEFT JOIN posts p ON g.target_type = 'post' AND p.id = g.target_id LEFT JOIN threads pt ON pt.id = p.thread_id LEFT JOIN profile_posts pp ON g.target_type = 'profile_post' AND pp.id = g.target_id LEFT JOIN profile_post_comments pc ON g.target_type = 'profile_post_comment' AND pc.id = g.target_id LEFT JOIN conversation_messages cm ON g.target_type = 'conversation_message' AND cm.id = g.target_id LEFT JOIN users u ON g.target_type = 'user' AND u.id = g.target_id WHERE g.state = ?1 AND (g.updated_at, g.id) < (?2, ?3) ORDER BY g.updated_at DESC, g.id DESC LIMIT ?4",
  ).all(input.state ?? "open", at, id, limit + 1);
  const items = filterModeratable(ctx, actor, rows.slice(0, limit), "reports").map(
    ({
      type: _type,
      node_id: _nodeId,
      conversation_id: _conversationId,
      target_exists: _exists,
      ...group
    }) => group,
  );
  const last = rows[limit - 1];
  return {
    items,
    nextCursor: rows.length > limit && last ? encodeCursor([last.updated_at, last.id]) : null,
  };
}

export function getReportGroup(ctx: Ctx, actor: Actor, groupId: number) {
  requireAuthenticated(actor);
  const group = read<ReportGroup>(
    ctx,
    "groupId",
    "SELECT * FROM report_groups WHERE id = ?1",
    groupId,
  );
  if (!group) throw new NotFoundError();
  requireContentModerator(ctx, actor, { type: group.target_type, id: group.target_id }, "report");
  const items = query<{ id: number; reporter_id: number; reason: string; created_at: number }>(
    ctx,
    "reportDetails",
    "SELECT id, reporter_id, reason, created_at FROM reports WHERE group_id = ?1 ORDER BY id",
  ).all(groupId);
  return { ...group, reports: items };
}

export function setReportState(
  ctx: Ctx,
  actor: Actor,
  groupId: number,
  state: "assigned" | "resolved" | "rejected",
  reason = "",
  assigneeId?: number,
) {
  const actorId = requireAuthenticated(actor).userId;
  return writeTx(ctx, () => {
    const group = read<ReportGroup>(
      ctx,
      "groupId",
      "SELECT * FROM report_groups WHERE id = ?1",
      groupId,
    );
    if (!group) throw new NotFoundError();
    requireContentModerator(ctx, actor, { type: group.target_type, id: group.target_id }, "report");
    if (state === "assigned" && assigneeId != null) {
      const assignedActor = principalMember(ctx, assigneeId);
      requireContentModerator(
        ctx,
        assignedActor,
        { type: group.target_type, id: group.target_id },
        "report",
      );
    }
    const now = ctx.now();
    exec(
      ctx,
      "groupState",
      "UPDATE report_groups SET state = ?1, assigned_to_id = ?2, updated_at = ?3, resolved_at = ?4 WHERE id = ?5",
      state,
      state === "assigned" ? (assigneeId ?? actorId) : group.assigned_to_id,
      now,
      state === "assigned" ? null : now,
      groupId,
    );
    appendModeratorLog(ctx, actor, `report.${state}`, group.target_type, group.target_id, reason, {
      groupId,
    });
    return {
      ...group,
      state,
      assigned_to_id: state === "assigned" ? (assigneeId ?? actorId) : group.assigned_to_id,
      updated_at: now,
      resolved_at: state === "assigned" ? null : now,
    };
  });
}

export const approvalSql =
  "SELECT p.id, p.thread_id, p.user_id, p.created_at, t.node_id FROM posts p JOIN threads t ON t.id = p.thread_id WHERE p.state = 'moderated' AND p.id <= ?1 ORDER BY p.id DESC LIMIT ?2";
export function listApprovals(
  ctx: Ctx,
  actor: Actor,
  input: { cursor?: string | null; limit?: number } = {},
) {
  requireAuthenticated(actor);
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const [cursorId, cursorType] = input.cursor
    ? decodeCursor(input.cursor, z.tuple([z.number().int().positive(), z.string()]))
    : [Number.MAX_SAFE_INTEGER, "~"];
  const rows: (Row & { type: ContentType })[] = [
    ...query<Row>(ctx, "approvalQueue", approvalSql)
      .all(cursorId, limit + 1)
      .map((r) => ({ ...r, type: "post" as const })),
    ...query<Row>(
      ctx,
      "approvalThreads",
      "SELECT id, user_id, node_id, created_at, state FROM threads WHERE state = 'moderated' AND id <= ?1 ORDER BY id DESC LIMIT ?2",
    )
      .all(cursorId, limit + 1)
      .map((r) => ({ ...r, type: "thread" as const })),
    ...query<Row>(
      ctx,
      "approvalProfilePosts",
      "SELECT id, user_id, created_at, state FROM profile_posts WHERE state = 'moderated' AND id <= ?1 ORDER BY id DESC LIMIT ?2",
    )
      .all(cursorId, limit + 1)
      .map((r) => ({ ...r, type: "profile_post" as const })),
    ...query<Row>(
      ctx,
      "approvalProfileComments",
      "SELECT id, user_id, profile_post_id, created_at, state FROM profile_post_comments WHERE state = 'moderated' AND id <= ?1 ORDER BY id DESC LIMIT ?2",
    )
      .all(cursorId, limit + 1)
      .map((r) => ({ ...r, type: "profile_post_comment" as const })),
    ...query<Row>(
      ctx,
      "approvalMessages",
      "SELECT id, user_id, conversation_id, created_at, state FROM conversation_messages WHERE state = 'moderated' AND id <= ?1 ORDER BY id DESC LIMIT ?2",
    )
      .all(cursorId, limit + 1)
      .map((r) => ({ ...r, type: "conversation_message" as const })),
  ];
  const candidates = rows
    .filter((row) => row.id < cursorId || (row.id === cursorId && row.type < cursorType))
    .sort((a, b) => b.id - a.id || b.type.localeCompare(a.type));
  const page = candidates.slice(0, limit);
  const items = filterModeratable(ctx, actor, page, "approvals");
  const last = page.at(-1);
  return {
    items,
    nextCursor: candidates.length > limit && last ? encodeCursor([last.id, last.type]) : null,
  };
}

export function listModeratorLog(
  ctx: Ctx,
  actor: Actor,
  input: { cursor?: string | null; limit?: number } = {},
) {
  requireGlobal(ctx, actor, "moderatorLog.view");
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const [at, id] = input.cursor
    ? decodeCursor(input.cursor, z.tuple([z.number().int(), z.number().int()]))
    : [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
  const rows = query<{ id: number; created_at: number }>(
    ctx,
    "logList",
    "SELECT * FROM moderator_log WHERE (created_at, id) < (?1, ?2) ORDER BY created_at DESC, id DESC LIMIT ?3",
  ).all(at, id, limit + 1);
  return {
    items: rows.slice(0, limit),
    nextCursor:
      rows.length > limit ? encodeCursor([rows[limit - 1]!.created_at, rows[limit - 1]!.id]) : null,
  };
}

function refreshThreadLast(ctx: Ctx, threadId: number) {
  const last = read<{ id: number; user_id: number; created_at: number }>(
    ctx,
    "visibleLastPost",
    "SELECT id, user_id, created_at FROM posts WHERE thread_id = ?1 AND state = 'visible' ORDER BY position DESC LIMIT 1",
    threadId,
  );
  if (!last) return;
  exec(
    ctx,
    "refreshThreadLast",
    "UPDATE threads SET last_post_at = ?1, last_post_id = ?2, last_poster_id = ?3 WHERE id = ?4",
    last.created_at,
    last.id,
    last.user_id,
    threadId,
  );
}
function refreshNodeLast(ctx: Ctx, nodeId: number) {
  type Last = {
    id: number;
    title: string;
    last_post_at: number;
    last_post_id: number;
    last_poster_id: number;
  };
  const sql = forumSql.nodeLast;
  const regular = read<Last>(ctx, "visibleNodeLast", sql, nodeId, 0);
  const sticky = read<Last>(ctx, "visibleNodeLast", sql, nodeId, 1);
  const last =
    !regular ||
    (sticky &&
      (sticky.last_post_at > regular.last_post_at ||
        (sticky.last_post_at === regular.last_post_at && sticky.id > regular.id)))
      ? sticky
      : regular;
  exec(
    ctx,
    "refreshNodeLast",
    "UPDATE nodes SET last_post_at = ?1, last_post_id = ?2, last_thread_id = ?3, last_thread_title = ?4, last_poster_id = ?5 WHERE id = ?6",
    last?.last_post_at ?? null,
    last?.last_post_id ?? null,
    last?.id ?? null,
    last?.title ?? null,
    last?.last_poster_id ?? null,
    nodeId,
  );
}
function stateChange(
  ctx: Ctx,
  target: Content,
  state: ContentStateValue,
  row = targetRow(ctx, target),
) {
  if (row.state === state) return false;
  if (target.type === "post" && row.id === row.first_post_id)
    throw new ValidationError("Change the thread state instead of its first post.");
  const delta = Number(state === "visible") - Number(row.state === "visible");
  const table = {
    thread: "threads",
    post: "posts",
    profile_post: "profile_posts",
    profile_post_comment: "profile_post_comments",
    conversation_message: "conversation_messages",
  }[target.type];
  exec(ctx, `state.${table}`, `UPDATE ${table} SET state = ?1 WHERE id = ?2`, state, row.id);
  if (delta !== 0 && (target.type === "profile_post" || target.type === "profile_post_comment"))
    exec(
      ctx,
      "touchModeratedProfile",
      "UPDATE users SET content_updated_at = ?1 WHERE id = ?2",
      ctx.now(),
      row.profile_user_id,
    );
  publishEvent(ctx, {
    type: state === "deleted" ? "content.deleted" : "content.state_changed",
    targetType: target.type,
    targetId: target.id,
    payload: { previousState: row.state, state },
  });
  if (target.type === "post" && delta !== 0) {
    exec(
      ctx,
      "replyCount",
      "UPDATE threads SET reply_count = reply_count + ?1 WHERE id = ?2",
      delta,
      row.thread_id,
    );
    refreshThreadLast(ctx, row.thread_id!);
    const thread = targetRow(ctx, { type: "thread", id: row.thread_id! });
    if (thread.state === "visible") {
      exec(
        ctx,
        "nodePostCount",
        "UPDATE nodes SET post_count = post_count + ?1 WHERE id = ?2",
        delta,
        row.node_id,
      );
      exec(
        ctx,
        "userPostCount",
        "UPDATE users SET post_count = post_count + ?1 WHERE id = ?2",
        delta,
        row.user_id,
      );
      refreshNodeLast(ctx, row.node_id!);
    }
  } else if (target.type === "thread" && delta !== 0) {
    exec(
      ctx,
      "nodeThreadCounts",
      "UPDATE nodes SET thread_count = thread_count + ?1, post_count = post_count + ?2 WHERE id = ?3",
      delta,
      delta * (row.reply_count! + 1),
      row.node_id,
    );
    exec(ctx, "threadAuthorCounts", forumSql.authorAdjustment, delta, row.id);
    refreshNodeLast(ctx, row.node_id!);
  } else if (target.type === "profile_post_comment" && delta !== 0) {
    exec(
      ctx,
      "commentCount",
      "UPDATE profile_posts SET comment_count = comment_count + ?1, last_comment_at = (SELECT created_at FROM profile_post_comments WHERE profile_post_id = ?2 AND state = 'visible' ORDER BY id DESC LIMIT 1) WHERE id = ?2",
      delta,
      row.profile_post_id,
    );
  } else if (target.type === "conversation_message" && delta !== 0) {
    if (row.state === "moderated" && state === "visible")
      exec(
        ctx,
        "resetApprovedMessageRead",
        "UPDATE conversation_participants SET last_read_message_id = 0 WHERE conversation_id = ?1 AND user_id != ?2 AND last_read_message_id = ?3",
        row.conversation_id,
        row.user_id,
        row.id,
      );
    exec(
      ctx,
      "conversationCount",
      "UPDATE conversations SET message_count = message_count + ?1 WHERE id = ?2",
      delta,
      row.conversation_id,
    );
    const last = read<{ id: number; user_id: number; created_at: number }>(
      ctx,
      "lastConversationMessage",
      "SELECT id, user_id, created_at FROM conversation_messages WHERE conversation_id = ?1 AND state = 'visible' ORDER BY id DESC LIMIT 1",
      row.conversation_id,
    );
    if (last) {
      exec(
        ctx,
        "conversationLast",
        "UPDATE conversations SET last_message_id = ?1, last_message_user_id = ?2, last_message_at = ?3 WHERE id = ?4",
        last.id,
        last.user_id,
        last.created_at,
        row.conversation_id,
      );
      exec(
        ctx,
        "participantLast",
        "UPDATE conversation_participants SET last_message_at = ?1 WHERE conversation_id = ?2",
        last.created_at,
        row.conversation_id,
      );
    }
  }
  return true;
}

export function moderateContent(
  ctx: Ctx,
  actor: Actor,
  target: Content,
  state: ContentStateValue,
  reason = "",
) {
  requireAuthenticated(actor);
  return writeTx(ctx, () => {
    const row = targetRow(ctx, target);
    requireContentModerator(
      ctx,
      actor,
      target,
      state === "deleted" ? "delete" : row.state === "deleted" ? "restore" : "approve",
      row,
    );
    const changed = stateChange(ctx, target, state, row);
    appendModeratorLog(ctx, actor, `content.${state}`, target.type, target.id, reason, { changed });
    return { changed };
  });
}

/** Called from an authorized edit transaction after a rule matches. It never approves content. */
export function moderateEditedContent(ctx: Ctx, actor: Actor, target: Content): void {
  const userId = requireAuthenticated(actor).userId;
  const row = targetRow(ctx, target);
  if (row.user_id !== userId) requireContentModerator(ctx, actor, target, "edit", row);
  if (row.state !== "visible") return;
  if (target.type === "post" && row.id === row.first_post_id)
    stateChange(ctx, { type: "thread", id: row.thread_id! }, "moderated");
  else stateChange(ctx, target, "moderated", row);
}

/** All items are validated and changed in one transaction; an invalid item rolls back the batch. */
export function bulkModerate(
  ctx: Ctx,
  actor: Actor,
  targets: Content[],
  action: "delete" | "restore" | "approve" | "move" | "lock" | "unlock",
  reason = "",
  nodeId?: number,
) {
  requireAuthenticated(actor);
  if (targets.length === 0 || targets.length > 100)
    throw new ValidationError("Select between 1 and 100 items.");
  if (
    (action === "move" || action === "lock" || action === "unlock") &&
    targets.some((t) => t.type !== "thread")
  )
    throw new ValidationError("This action requires threads.");
  return writeTx(ctx, () => {
    if (action === "move") {
      if (
        nodeId == null ||
        !can(ctx, actor, "forum.move", { nodeId }) ||
        !read(ctx, "forumNode", "SELECT id FROM nodes WHERE id = ?1 AND type = 'forum'", nodeId)
      )
        throw new NotFoundError();
    }
    let changed = 0;
    for (const target of targets) {
      const current = targetRow(ctx, target);
      const permissionAction =
        action === "restore" && current.state === "moderated"
          ? "approve"
          : action === "unlock"
            ? "lock"
            : action;
      const row = requireContentModerator(ctx, actor, target, permissionAction, current);
      if (action === "move") {
        if (row.node_id === nodeId) {
          appendModeratorLog(ctx, actor, `bulk.${action}`, target.type, target.id, reason, {
            nodeId,
            changed: false,
          });
          continue;
        }
        exec(ctx, "moveThread", "UPDATE threads SET node_id = ?1 WHERE id = ?2", nodeId, row.id);
        publishEvent(ctx, {
          type: "content.edited",
          targetType: "thread",
          targetId: row.id,
          payload: { movedToNodeId: nodeId },
        });
        if (row.state === "visible") {
          const n = row.reply_count! + 1;
          exec(
            ctx,
            "nodeThreadCounts",
            "UPDATE nodes SET thread_count = thread_count + ?1, post_count = post_count + ?2 WHERE id = ?3",
            -1,
            -n,
            row.node_id,
          );
          exec(
            ctx,
            "nodeThreadCounts",
            "UPDATE nodes SET thread_count = thread_count + ?1, post_count = post_count + ?2 WHERE id = ?3",
            1,
            n,
            nodeId,
          );
          refreshNodeLast(ctx, row.node_id!);
          refreshNodeLast(ctx, nodeId!);
        }
      } else if (action === "lock" || action === "unlock") {
        if (!!row.is_locked === (action === "lock")) {
          appendModeratorLog(ctx, actor, `bulk.${action}`, target.type, target.id, reason, {
            changed: false,
          });
          continue;
        }
        exec(
          ctx,
          "threadLock",
          "UPDATE threads SET is_locked = ?1 WHERE id = ?2",
          Number(action === "lock"),
          row.id,
        );
        publishEvent(ctx, {
          type: "content.edited",
          targetType: "thread",
          targetId: row.id,
          payload: { isLocked: action === "lock" },
        });
      } else {
        if (action === "approve" && row.state !== "moderated")
          throw new ConflictError("Only moderated content can be approved.");
        if (!stateChange(ctx, target, action === "delete" ? "deleted" : "visible", row)) {
          appendModeratorLog(ctx, actor, `bulk.${action}`, target.type, target.id, reason, {
            changed: false,
          });
          continue;
        }
      }
      appendModeratorLog(
        ctx,
        actor,
        `bulk.${action}`,
        target.type,
        target.id,
        reason,
        action === "move" ? { nodeId } : {},
      );
      changed++;
    }
    return { changed };
  });
}

export type Filter = {
  term: string;
  action: "replace" | "moderate";
  replacement?: string | null;
  isActive?: boolean;
};
/** Call before rendering new content. The returned source is what must be stored and rendered. */
export function applyWordFilters(ctx: Ctx, source: string): { source: string; moderated: boolean } {
  const filters = query<{
    term: string;
    action: "replace" | "moderate";
    replacement: string | null;
  }>(
    ctx,
    "activeFilters",
    "SELECT term, action, replacement FROM word_filters INDEXED BY word_filters_active WHERE is_active = 1 ORDER BY id",
  ).all();
  let body = source;
  let moderated = false;
  for (const filter of filters) {
    if (!filter.term) continue;
    const escaped = filter.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(escaped, "giu");
    if (filter.action === "moderate") {
      if (pattern.test(body)) moderated = true;
    } else body = body.replace(pattern, () => filter.replacement ?? "");
  }
  return { source: body, moderated };
}
export const applyWordFilter = applyWordFilters;

/** Evaluate configurable approval rules before rendering, then recheck the decision in the write transaction. */
export const prepareModeratedContent = markPublic(
  "Content callers authorize submissions before approval rules.",
  function prepareModeratedContent(ctx: Ctx, actor: Actor, source: string, forumPost: boolean) {
    const userId = requireAuthenticated(actor).userId;
    const filtered = applyWordFilters(ctx, source);
    const settings = readSiteSettings(ctx);
    const user = read<{ created_at: number }>(
      ctx,
      "authorCreated",
      "SELECT created_at FROM users WHERE id = ?1",
      userId,
    );
    if (!user) throw new NotFoundError();
    const newMember = user.created_at > ctx.now() - settings.newMemberDays * 86_400_000;
    const firstPosts =
      forumPost &&
      settings.firstPostsToModerate > 0 &&
      query<{ id: number }>(
        ctx,
        "authorPostSample",
        "SELECT id FROM posts WHERE user_id = ?1 ORDER BY id LIMIT ?2",
      ).all(userId, settings.firstPostsToModerate).length < settings.firstPostsToModerate;
    return {
      source: filtered.source,
      moderated:
        filtered.moderated ||
        firstPosts ||
        (settings.moderateLinksFromNewMembers &&
          newMember &&
          /(?:https?:\/\/|www\.)/i.test(filtered.source)),
    };
  },
);

export function upsertWordFilter(ctx: Ctx, actor: Actor, filter: Filter) {
  requireGlobal(ctx, actor, "wordFilter.manage");
  const term = filter.term.trim();
  if (!term) throw new ValidationError("A filter term is required.");
  if (filter.action === "replace" && filter.replacement == null)
    throw new ValidationError("A replacement is required.");
  return writeTx(ctx, () => {
    const now = ctx.now();
    exec(
      ctx,
      "filterUpsert",
      "INSERT INTO word_filters (term, action, replacement, is_active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5) ON CONFLICT(term) DO UPDATE SET action = excluded.action, replacement = excluded.replacement, is_active = excluded.is_active, updated_at = excluded.updated_at",
      term,
      filter.action,
      filter.replacement ?? null,
      Number(filter.isActive ?? true),
      now,
    );
    const row = read<{ id: number }>(
      ctx,
      "filterId",
      "SELECT id FROM word_filters WHERE term = ?1",
      term,
    )!;
    appendModeratorLog(ctx, actor, "word_filter.upsert", "word_filter", row.id, term);
    return { id: row.id };
  });
}

export function removeWordFilter(ctx: Ctx, actor: Actor, id: number) {
  requireGlobal(ctx, actor, "wordFilter.manage");
  return writeTx(ctx, () => {
    const row = read<{ id: number }>(
      ctx,
      "filterById",
      "SELECT id FROM word_filters WHERE id = ?1",
      id,
    );
    if (!row) throw new NotFoundError();
    exec(ctx, "filterRemove", "DELETE FROM word_filters WHERE id = ?1", id);
    appendModeratorLog(ctx, actor, "word_filter.remove", "word_filter", id);
    return { ok: true };
  });
}

export function listWordFilters(ctx: Ctx, actor: Actor) {
  requireGlobal(ctx, actor, "wordFilter.view");
  return { items: query(ctx, "allFilters", "SELECT * FROM word_filters ORDER BY id").all() };
}

/** Capture the former body in the same transaction as the caller's post UPDATE. */
export function recordPostRevision(ctx: Ctx, actor: Actor, postId: number): number {
  const editorId = requireAuthenticated(actor).userId;
  const post = targetRow(ctx, { type: "post", id: postId });
  if (post.user_id !== editorId)
    requireContentModerator(ctx, actor, { type: "post", id: postId }, "edit", post);
  const body = read<{ body_source: string; body_html: string }>(
    ctx,
    "revisionSource",
    "SELECT body_source, body_html FROM post_bodies WHERE post_id = ?1",
    postId,
  );
  if (!body) throw new NotFoundError();
  const id = Number(
    exec(
      ctx,
      "revisionInsert",
      "INSERT INTO post_revisions (post_id, editor_id, body_source, body_html, edited_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      postId,
      editorId,
      body.body_source,
      body.body_html,
      ctx.now(),
    ).lastInsertRowid,
  );
  if (post.user_id !== editorId) appendModeratorLog(ctx, actor, "post.edit", "post", postId);
  return id;
}

export function listPostRevisions(
  ctx: Ctx,
  actor: Actor,
  postId: number,
  input: { cursor?: string | null; limit?: number } = {},
) {
  requireContentModerator(ctx, actor, { type: "post", id: postId }, "history");
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const cursor = input.cursor
    ? decodeCursor(input.cursor, z.tuple([z.number().int().positive()]))[0]
    : Number.MAX_SAFE_INTEGER;
  const rows = query<{ id: number }>(
    ctx,
    "revisions",
    "SELECT * FROM post_revisions WHERE post_id = ?1 AND id < ?2 ORDER BY id DESC LIMIT ?3",
  ).all(postId, cursor, limit + 1);
  return {
    items: rows.slice(0, limit),
    nextCursor: rows.length > limit ? encodeCursor([rows[limit - 1]!.id]) : null,
  };
}

export function addWarning(
  ctx: Ctx,
  actor: Actor,
  userId: number,
  points: number,
  reason: string,
  expiresAt: number | null = null,
) {
  requireAuthenticated(actor);
  requirePermission(ctx, actor, "member.warn", { target: principalMember(ctx, userId) });
  if (!Number.isInteger(points) || points <= 0 || !reason.trim())
    throw new ValidationError("Positive points and a reason are required.");
  return writeTx(ctx, () => {
    const target = principalMember(ctx, userId);
    requirePermission(ctx, actor, "member.warn", { target });
    const now = ctx.now();
    const id = Number(
      exec(
        ctx,
        "warningInsert",
        "INSERT INTO warnings (user_id, moderator_id, points, reason, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        userId,
        actorUserId(actor),
        points,
        reason,
        now,
        expiresAt,
      ).lastInsertRowid,
    );
    appendModeratorLog(ctx, actor, "warning.add", "user", userId, reason, {
      warningId: id,
      points,
      expiresAt,
    });
    const activePoints = read<{ n: number }>(
      ctx,
      "activePoints",
      "SELECT coalesce(sum(points), 0) AS n FROM warnings WHERE user_id = ?1 AND (expires_at IS NULL OR expires_at > ?2)",
      userId,
      now,
    )!.n;
    const settings = readSiteSettings(ctx);
    const threshold = settings.warningBanThreshold;
    if (threshold > 0 && activePoints >= threshold && !can(ctx, target, "member.immuneToAutoBan")) {
      const expires = now + settings.warningBanDays * 86_400_000;
      exec(
        ctx,
        "autoBan",
        "UPDATE users SET banned_until = max(coalesce(banned_until, 0), ?1) WHERE id = ?2",
        expires,
        userId,
      );
      const banId = Number(
        exec(
          ctx,
          "banInsert",
          "INSERT INTO bans (user_id, moderator_id, reason, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)",
          userId,
          actorUserId(actor),
          `Warning threshold: ${activePoints} points`,
          now,
          expires,
        ).lastInsertRowid,
      );
      appendModeratorLog(ctx, actor, "ban.threshold", "user", userId, reason, {
        banId,
        activePoints,
      });
      enqueueJob(
        ctx,
        "moderation.revokeCredentials",
        { userId },
        { uniqueKey: `moderation.revokeCredentials.${banId}` },
      );
    }
    return { id, activePoints };
  });
}

export function banUser(
  ctx: Ctx,
  actor: Actor,
  userId: number,
  reason: string,
  expiresAt: number | null,
) {
  requireAuthenticated(actor);
  requirePermission(ctx, actor, "member.ban", { target: principalMember(ctx, userId) });
  if (!reason.trim() || (expiresAt != null && expiresAt <= ctx.now()))
    throw new ValidationError("A reason and future expiry are required.");
  return writeTx(ctx, () => {
    const target = principalMember(ctx, userId);
    requirePermission(ctx, actor, "member.ban", { target });
    if (userId === actorUserId(actor)) throw new ForbiddenError();
    return insertBan(ctx, actor, userId, reason, expiresAt);
  });
}

function insertBan(
  ctx: Ctx,
  actor: Actor,
  userId: number,
  reason: string,
  expiresAt: number | null,
) {
  const now = ctx.now();
  const id = Number(
    exec(
      ctx,
      "banInsert",
      "INSERT INTO bans (user_id, moderator_id, reason, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      userId,
      actorUserId(actor),
      reason,
      now,
      expiresAt,
    ).lastInsertRowid,
  );
  refreshBanState(ctx, userId, now);
  appendModeratorLog(ctx, actor, "ban.add", "user", userId, reason, { banId: id, expiresAt });
  enqueueJob(
    ctx,
    "moderation.revokeCredentials",
    { userId },
    { uniqueKey: `moderation.revokeCredentials.${id}` },
  );
  return { id };
}

function refreshBanState(ctx: Ctx, userId: number, now: number) {
  const active = read<{ expires_at: number | null }>(
    ctx,
    "remainingBan",
    "SELECT expires_at FROM bans WHERE user_id = ?1 AND lifted_at IS NULL AND (expires_at IS NULL OR expires_at > ?2) ORDER BY (expires_at IS NULL) DESC, expires_at DESC LIMIT 1",
    userId,
    now,
  );
  exec(
    ctx,
    "refreshBan",
    "UPDATE users SET banned_until = ?1, banned_permanently = ?2 WHERE id = ?3",
    active?.expires_at ?? null,
    Number(active != null && active.expires_at == null),
    userId,
  );
}

export function listWarnings(
  ctx: Ctx,
  actor: Actor,
  userId: number,
  input: { cursor?: string | null; limit?: number } = {},
) {
  const viewer = requireAuthenticated(actor).userId;
  if (viewer !== userId && !can(ctx, actor, "warning.view")) throw new ForbiddenError();
  if (!read(ctx, "userExists", "SELECT id FROM users WHERE id = ?1", userId))
    throw new NotFoundError();
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const cursor = input.cursor
    ? decodeCursor(input.cursor, z.tuple([z.number().int().positive()]))[0]
    : Number.MAX_SAFE_INTEGER;
  const rows = query<{ id: number }>(
    ctx,
    "warningList",
    "SELECT * FROM warnings WHERE user_id = ?1 AND id < ?2 ORDER BY id DESC LIMIT ?3",
  ).all(userId, cursor, limit + 1);
  return {
    items: rows.slice(0, limit),
    nextCursor: rows.length > limit ? encodeCursor([rows[limit - 1]!.id]) : null,
  };
}

export function liftBan(ctx: Ctx, actor: Actor, banId: number, reason: string) {
  requireAuthenticated(actor);
  return writeTx(ctx, () => {
    const ban = read<{ user_id: number; lifted_at: number | null }>(
      ctx,
      "banById",
      "SELECT user_id, lifted_at FROM bans WHERE id = ?1",
      banId,
    );
    if (!ban) throw new NotFoundError();
    requirePermission(ctx, actor, "member.ban", { target: principalMember(ctx, ban.user_id) });
    if (ban.lifted_at != null) throw new ConflictError("This ban was already lifted.");
    const now = ctx.now();
    exec(ctx, "liftBan", "UPDATE bans SET lifted_at = ?1 WHERE id = ?2", now, banId);
    refreshBanState(ctx, ban.user_id, now);
    appendModeratorLog(ctx, actor, "ban.lift", "user", ban.user_id, reason, { banId });
    return { ok: true };
  });
}

type SpamStage =
  | "thread"
  | "post"
  | "profile_post"
  | "profile_post_comment"
  | "conversation_message";
const spamStages: SpamStage[] = [
  "thread",
  "post",
  "profile_post",
  "profile_post_comment",
  "conversation_message",
];
export type SpamCursor = { stage: SpamStage; before: number };
export type SpamCleanupJob = {
  actorId: number;
  userId: number;
  cursor: SpamCursor;
  limit: number;
  reason: string;
};

/** Process one bounded batch. The job handler must pass the queued cursor back here. */
export function resumeSpamCleanup(
  ctx: Ctx,
  actor: Actor,
  userId: number,
  cursor: SpamCursor | null,
  limit = 100,
  reason = "Spam cleanup",
) {
  requireAuthenticated(actor);
  requirePermission(ctx, actor, "member.spamCleanup", { target: principalMember(ctx, userId) });
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new ValidationError("Limit must be between 1 and 100.");
  if (
    cursor &&
    (!spamStages.includes(cursor.stage) ||
      !Number.isSafeInteger(cursor.before) ||
      cursor.before < 1)
  )
    throw new ValidationError("Invalid spam cleanup cursor.");
  return writeTx(ctx, () => {
    requirePermission(ctx, actor, "member.spamCleanup", { target: principalMember(ctx, userId) });
    if (cursor === null) {
      const prior = read<{ id: number }>(
        ctx,
        "spamCleanupBan",
        "SELECT id FROM bans WHERE user_id = ?1 AND expires_at IS NULL AND lifted_at IS NULL LIMIT 1",
        userId,
      );
      if (!prior) insertBan(ctx, actor, userId, "Spam cleanup", null);
    }
    const targets: Content[] = [];
    let stageIndex = cursor ? spamStages.indexOf(cursor.stage) : 0;
    let before = cursor?.before ?? Number.MAX_SAFE_INTEGER;
    let nextCursor: SpamCursor | null = null;
    while (stageIndex < spamStages.length && targets.length < limit) {
      const stage = spamStages[stageIndex]!;
      const sql = {
        thread:
          "SELECT id FROM threads WHERE user_id = ?1 AND id < ?2 AND state != 'deleted' ORDER BY id DESC LIMIT ?3",
        post: "SELECT p.id FROM posts p JOIN threads t ON t.id = p.thread_id WHERE p.user_id = ?1 AND p.id < ?2 AND p.state != 'deleted' AND p.id != t.first_post_id ORDER BY p.id DESC LIMIT ?3",
        profile_post:
          "SELECT id FROM profile_posts WHERE user_id = ?1 AND id < ?2 AND state != 'deleted' ORDER BY id DESC LIMIT ?3",
        profile_post_comment:
          "SELECT id FROM profile_post_comments WHERE user_id = ?1 AND id < ?2 AND state != 'deleted' ORDER BY id DESC LIMIT ?3",
        conversation_message:
          "SELECT id FROM conversation_messages WHERE user_id = ?1 AND id < ?2 AND state != 'deleted' ORDER BY id DESC LIMIT ?3",
      }[stage];
      const remaining = limit - targets.length;
      const rows = query<{ id: number }>(ctx, `spam.${stage}`, sql).all(userId, before, remaining);
      targets.push(...rows.map((row) => ({ type: stage, id: row.id })));
      if (rows.length === remaining) {
        nextCursor = { stage, before: rows.at(-1)!.id };
        break;
      }
      stageIndex++;
      before = Number.MAX_SAFE_INTEGER;
    }
    let changed = 0;
    for (const target of targets) {
      const row = targetRow(ctx, target);
      if (row.user_id !== userId) throw new ConflictError("Spam cleanup target changed.");
      if (stateChange(ctx, target, "deleted", row)) changed++;
      appendModeratorLog(
        ctx,
        actor,
        target.type === "conversation_message" ? "spam.cleanup.message" : "bulk.delete",
        target.type,
        target.id,
        reason,
      );
    }
    if (nextCursor) {
      enqueueJob(
        ctx,
        "moderation.cleanupSpam",
        {
          actorId: actorUserId(actor)!,
          userId,
          cursor: nextCursor,
          limit,
          reason,
        } satisfies SpamCleanupJob,
        { uniqueKey: `spam-cleanup:${userId}:${nextCursor.stage}:${nextCursor.before}` },
      );
    }
    appendModeratorLog(ctx, actor, "spam.cleanup.batch", "user", userId, reason, {
      changed,
      nextCursor,
    });
    return { changed, nextCursor };
  });
}

/** Ban once and begin deleting every public item, continuing through queued batches. */
export function cleanupSpam(
  ctx: Ctx,
  actor: Actor,
  userId: number,
  since: number,
  limit = 100,
  reason = "Spam cleanup",
) {
  void since;
  return resumeSpamCleanup(ctx, actor, userId, null, limit, reason);
}

function publicRow(value: unknown): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const name = key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
    result[name] =
      key.endsWith("_at") && typeof item === "number"
        ? iso(item)
        : key === "is_active"
          ? Boolean(item)
          : key === "details" && typeof item === "string"
            ? JSON.parse(item)
            : item;
  }
  return result;
}

const page = <T extends { items: unknown[]; nextCursor: string | null }>(value: T) => ({
  items: value.items.map(publicRow),
  nextCursor: value.nextCursor,
});

export const operations = [
  implement(contracts.reportsCreate, (ctx, actor, input) =>
    createReport(ctx, actor, input.target, input.reason),
  ),
  implement(contracts.reportsList, (ctx, actor, input) =>
    contracts.reportsList.output.parse(page(listReports(ctx, actor, input))),
  ),
  implement(contracts.reportsGet, (ctx, actor, input) => {
    const group = getReportGroup(ctx, actor, input.groupId);
    return contracts.reportsGet.output.parse({
      ...publicRow(group),
      reports: group.reports.map(publicRow),
    });
  }),
  implement(contracts.reportsSetState, (ctx, actor, input) =>
    contracts.reportsSetState.output.parse(
      publicRow(
        setReportState(ctx, actor, input.groupId, input.state, input.reason, input.assigneeId),
      ),
    ),
  ),
  implement(contracts.approvalsList, (ctx, actor, input) => {
    const result = listApprovals(ctx, actor, input);
    return contracts.approvalsList.output.parse({
      items: result.items.map((row) => ({
        type: row.type,
        id: row.id,
        authorId: row.user_id,
        createdAt: iso(row.created_at!),
      })),
      nextCursor: result.nextCursor,
    });
  }),
  implement(contracts.moderationSetState, (ctx, actor, input) =>
    moderateContent(ctx, actor, input.target, input.state, input.reason),
  ),
  implement(contracts.moderationBulk, (ctx, actor, input) =>
    bulkModerate(ctx, actor, input.targets, input.action, input.reason, input.nodeId),
  ),
  implement(contracts.moderatorLogList, (ctx, actor, input) =>
    contracts.moderatorLogList.output.parse(page(listModeratorLog(ctx, actor, input))),
  ),
  implement(contracts.wordFiltersList, (ctx, actor) =>
    contracts.wordFiltersList.output.parse({
      items: listWordFilters(ctx, actor).items.map(publicRow),
    }),
  ),
  implement(contracts.wordFiltersUpsert, (ctx, actor, input) =>
    upsertWordFilter(ctx, actor, input),
  ),
  implement(
    contracts.wordFiltersRemove,
    (ctx, actor, input) => removeWordFilter(ctx, actor, input.filterId) as { ok: true },
  ),
  implement(contracts.warningsCreate, (ctx, actor, input) =>
    addWarning(
      ctx,
      actor,
      input.userId,
      input.points,
      input.reason,
      input.expiresAt ? Date.parse(input.expiresAt) : null,
    ),
  ),
  implement(contracts.warningsList, (ctx, actor, input) =>
    contracts.warningsList.output.parse(page(listWarnings(ctx, actor, input.userId, input))),
  ),
  implement(contracts.bansCreate, (ctx, actor, input) =>
    banUser(
      ctx,
      actor,
      input.userId,
      input.reason,
      input.expiresAt ? Date.parse(input.expiresAt) : null,
    ),
  ),
  implement(
    contracts.bansLift,
    (ctx, actor, input) => liftBan(ctx, actor, input.banId, input.reason) as { ok: true },
  ),
  implement(contracts.postRevisionsList, (ctx, actor, input) =>
    contracts.postRevisionsList.output.parse(
      page(listPostRevisions(ctx, actor, input.postId, input)),
    ),
  ),
  implement(contracts.spamCleanupStart, (ctx, actor, input) => {
    requireAuthenticated(actor);
    requirePermission(ctx, actor, "member.spamCleanup", {
      target: principalMember(ctx, input.userId),
    });
    return writeTx(ctx, () => {
      requirePermission(ctx, actor, "member.spamCleanup", {
        target: principalMember(ctx, input.userId),
      });
      if (actorUserId(actor) === input.userId) throw new ForbiddenError();
      const actorId = requireAuthenticated(actor).userId;
      const existing = read<{ id: number }>(
        ctx,
        "spamJobExists",
        "SELECT id FROM jobs WHERE unique_key = ?1",
        `moderation.cleanupSpam.${input.userId}`,
      );
      if (existing) throw new ConflictError("Spam cleanup is already queued.");
      insertBan(ctx, actor, input.userId, input.reason, null);
      const jobId = enqueueJob(
        ctx,
        "moderation.cleanupSpam",
        {
          actorId,
          userId: input.userId,
          cursor: null,
          limit: 100,
          reason: input.reason,
        },
        { uniqueKey: `moderation.cleanupSpam.${input.userId}` },
      );
      if (jobId === null) throw new ConflictError("Spam cleanup is already queued.");
      appendModeratorLog(ctx, actor, "spam.cleanup.queued", "user", input.userId, input.reason, {
        jobId,
      });
      return { jobId };
    });
  }),
];

export function registerModerationJobs(ctx: Ctx): void {
  registerJobHandler(ctx, "moderation.revokeCredentials", async (_ctx, payload) => {
    const userId = (payload as { userId?: unknown })?.userId;
    if (!Number.isSafeInteger(userId) || Number(userId) < 1)
      throw new ValidationError("Invalid credential revocation job.");
    await revokeUserCredentials(ctx, Number(userId));
  });
  registerJobHandler(ctx, "moderation.cleanupSpam", (_ctx, payload) => {
    const job = payload as {
      actorId: number;
      userId: number;
      cursor: SpamCursor | null;
      limit: number;
      reason: string;
    };
    const user = read<PrincipalRow & { id: number; group_id: number }>(
      ctx,
      "spamActor",
      `SELECT u.id, u.group_id, ${PRINCIPAL_COLUMNS} FROM users u WHERE u.id = ?1`,
      job.actorId,
    );
    if (!user) throw new NotFoundError();
    const actor = memberActor(user.id, user.group_id, user, currentVersions(ctx));
    resumeSpamCleanup(ctx, actor, job.userId, job.cursor, job.limit, job.reason);
  });
}
