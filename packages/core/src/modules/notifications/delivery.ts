import { type Actor, actorUserId } from "../../actor";
import type { Ctx } from "../../context";
import { prepared } from "../../context";
import { writeTx } from "../../db/tx";
import {
  CONTENT_EVENT_TYPES,
  type DomainEvent,
  publishEvent,
  registerEventSubscriber,
} from "../../events";
import {
  can,
  currentVersions,
  memberActor,
  PRINCIPAL_COLUMNS,
  type PrincipalRow,
  permissionState,
} from "../../permissions";
import { allCombinations, flagAt } from "../../permissions/state";
import { enqueueJob, registerJobHandler } from "../jobs";
import { readSiteSettings } from "../settings";
import { typeById } from "./types";

type Content = {
  type: string;
  id: number;
  userId: number;
  state: string;
  threadId: number | null;
  nodeId: number | null;
  profileUserId: number | null;
  parentId: number | null;
  firstPostId: number | null;
  conversationId: number | null;
  position: number | null;
};
type Stage = {
  name: string;
  type: string;
  sql: string;
  sourceId: number;
  data?: Record<string, unknown>;
  /** Fixed candidates (member ids from a payload or the event history), read in id order. */
  ids?: number[];
  selector?: string;
  reportTargetType?: string;
};
type Recipient = PrincipalRow & {
  id: number;
  group_id: number;
  banned_permanently: number;
  banned_until: number | null;
  notification_epoch: number;
};
type Progress = {
  eventId: number;
  phase: number;
  after: number;
  deleteAfter?: number;
  /** Name of the stage at `phase`: stages are rebuilt on resume and may differ by then. */
  stage?: string;
};
const BATCH = 40;
/** Rows an event wrote are looked up from its creation time less this, in case the clock stepped back. */
const CLOCK_MARGIN = 3_600_000;

function eventRow(ctx: Ctx, id: number): DomainEvent | null {
  const row = prepared(ctx, "notifications.event", () =>
    ctx.sqlite.prepare<
      {
        id: number;
        type: DomainEvent["type"];
        target_type: string;
        target_id: number;
        payload: string;
        created_at: number;
      },
      [number]
    >(
      "SELECT id, type, target_type, target_id, payload, created_at FROM domain_events WHERE id = ?1",
    ),
  ).get(id);
  return (
    row && {
      id: row.id,
      type: row.type,
      targetType: row.target_type,
      targetId: row.target_id,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
      createdAt: row.created_at,
    }
  );
}

function content(ctx: Ctx, event: DomainEvent): Content | null {
  const id = event.targetId;
  switch (event.targetType) {
    case "thread": {
      const row = prepared(ctx, "notifications.content.thread", () =>
        ctx.sqlite.prepare<
          { user_id: number; state: string; node_id: number; first_post_id: number | null },
          [number]
        >("SELECT user_id, state, node_id, first_post_id FROM threads WHERE id = ?1"),
      ).get(id);
      return (
        row && {
          type: "thread",
          id,
          userId: row.user_id,
          state: row.state,
          threadId: id,
          nodeId: row.node_id,
          profileUserId: null,
          parentId: null,
          firstPostId: row.first_post_id,
          conversationId: null,
          position: 0,
        }
      );
    }
    case "post": {
      const row = prepared(ctx, "notifications.content.post", () =>
        ctx.sqlite.prepare<
          {
            user_id: number;
            state: string;
            thread_id: number;
            node_id: number;
            thread_state: string;
            first_post_id: number | null;
            position: number;
          },
          [number]
        >(
          "SELECT p.user_id, p.state, p.thread_id, p.position, t.node_id, t.state AS thread_state, t.first_post_id FROM posts p JOIN threads t ON t.id = p.thread_id WHERE p.id = ?1",
        ),
      ).get(id);
      return (
        row && {
          type: "post",
          id,
          userId: row.user_id,
          state: row.thread_state === "visible" ? row.state : row.thread_state,
          threadId: row.thread_id,
          nodeId: row.node_id,
          profileUserId: null,
          parentId: null,
          firstPostId: row.first_post_id,
          conversationId: null,
          position: row.position,
        }
      );
    }
    case "profile_post": {
      const row = prepared(ctx, "notifications.content.profilePost", () =>
        ctx.sqlite.prepare<{ user_id: number; profile_user_id: number; state: string }, [number]>(
          "SELECT user_id, profile_user_id, state FROM profile_posts WHERE id = ?1",
        ),
      ).get(id);
      return (
        row && {
          type: "profile_post",
          id,
          userId: row.user_id,
          state: row.state,
          threadId: null,
          nodeId: null,
          profileUserId: row.profile_user_id,
          parentId: null,
          firstPostId: null,
          conversationId: null,
          position: null,
        }
      );
    }
    case "profile_post_comment": {
      const row = prepared(ctx, "notifications.content.profileComment", () =>
        ctx.sqlite.prepare<
          {
            user_id: number;
            profile_post_id: number;
            state: string;
            parent_state: string;
            parent_user_id: number;
            profile_user_id: number;
          },
          [number]
        >(
          "SELECT c.user_id, c.profile_post_id, c.state, p.state AS parent_state, p.user_id AS parent_user_id, p.profile_user_id FROM profile_post_comments c JOIN profile_posts p ON p.id = c.profile_post_id WHERE c.id = ?1",
        ),
      ).get(id);
      return (
        row && {
          type: "profile_post_comment",
          id,
          userId: row.user_id,
          state: row.parent_state === "visible" ? row.state : row.parent_state,
          threadId: null,
          nodeId: null,
          profileUserId: row.profile_user_id,
          parentId: row.profile_post_id,
          firstPostId: null,
          conversationId: null,
          position: null,
        }
      );
    }
    case "conversation_message": {
      const row = prepared(ctx, "notifications.content.message", () =>
        ctx.sqlite.prepare<{ user_id: number; conversation_id: number; state: string }, [number]>(
          "SELECT user_id, conversation_id, state FROM conversation_messages WHERE id = ?1",
        ),
      ).get(id);
      return (
        row && {
          type: "conversation_message",
          id,
          userId: row.user_id,
          state: row.state,
          threadId: null,
          nodeId: null,
          profileUserId: null,
          parentId: null,
          firstPostId: null,
          conversationId: row.conversation_id,
          position: null,
        }
      );
    }
    default:
      return null;
  }
}

const source = (
  name: string,
  type: string,
  sql: string,
  sourceId: number,
  data?: Record<string, unknown>,
): Stage => ({ name, type, sql, sourceId, data });

const LIST_SQL =
  "SELECT value AS user_id FROM json_each(?1) WHERE value > ?2 ORDER BY value LIMIT ?3";
const listed = (
  name: string,
  type: string,
  ids: unknown,
  data?: Record<string, unknown>,
): Stage => ({
  name,
  type,
  sql: LIST_SQL,
  sourceId: 0,
  data,
  ids: [
    ...new Set(Array.isArray(ids) ? ids.filter((id): id is number => typeof id === "number") : []),
  ],
});

type PastEvent = { id: number; type: string; payload: Record<string, unknown> };

/** Events of one target with ids between `after` and `before` (exclusive), oldest first. */
function pastEvents(
  ctx: Ctx,
  targetType: string,
  targetId: number,
  before: number,
  types: readonly string[],
  after = 0,
): PastEvent[] {
  return prepared(ctx, "notifications.history", () =>
    ctx.sqlite.prepare<
      { id: number; type: string; payload: string },
      [string, number, number, number, string]
    >(
      "SELECT id, type, payload FROM domain_events WHERE target_type = ?1 AND target_id = ?2 AND id > ?3 AND id < ?4 AND type IN (SELECT value FROM json_each(?5)) ORDER BY id",
    ),
  )
    .all(targetType, targetId, after, before, JSON.stringify(types))
    .map((row) => ({
      id: row.id,
      type: row.type,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
    }));
}

/** Content events before `event`; a thread includes its first post's (edits target the post). */
function contentHistory(ctx: Ctx, event: DomainEvent, item: Content): PastEvent[] {
  const events = pastEvents(ctx, item.type, item.id, event.id, CONTENT_EVENT_TYPES);
  if (item.type === "thread" && item.firstPostId !== null)
    events.push(...pastEvents(ctx, "post", item.firstPostId, event.id, CONTENT_EVENT_TYPES));
  return events.sort((a, b) => a.id - b.id);
}

/**
 * The content's state when it was created: the previous state of its first later state change,
 * or its current state when it has not changed since. A created job that runs late must not act
 * on a state the content reached afterwards (the approval or the hiding event handles that).
 */
function stateAtCreation(ctx: Ctx, event: DomainEvent, item: Content): string {
  const next = pastEvents(
    ctx,
    item.type,
    item.id,
    Number.MAX_SAFE_INTEGER,
    ["content.state_changed", "content.deleted"],
    event.id,
  )[0];
  return typeof next?.payload.previousState === "string" ? next.payload.previousState : item.state;
}

/** Members among `ids` who already have a mention notice for the content newer than `after`. */
function alreadyMentioned(ctx: Ctx, item: Content, ids: number[], after: number): Set<number> {
  const targets: Array<[string, number]> = [[item.type, item.id]];
  if (item.type === "thread" && item.firstPostId !== null) targets.push(["post", item.firstPostId]);
  if (item.type === "post" && item.id === item.firstPostId && item.threadId !== null)
    targets.push(["thread", item.threadId]);
  const stmt = prepared(ctx, "notifications.alreadyMentioned", () =>
    ctx.sqlite.prepare<{ user_id: number }, [string, number, number, string]>(
      "SELECT user_id FROM notifications WHERE content_type = ?1 AND content_id = ?2 AND type = 'content.mentioned' AND last_event_id > ?3 AND user_id IN (SELECT value FROM json_each(?4))",
    ),
  );
  return new Set(
    targets.flatMap(([type, id]) =>
      stmt.all(type, id, after, JSON.stringify(ids)).map((row) => row.user_id),
    ),
  );
}

/** A state change that made the content visible (restores without a payload always do). */
const madeVisible = (e: PastEvent) =>
  e.type === "content.state_changed" && (e.payload.state ?? "visible") === "visible";
const madeHidden = (e: PastEvent) =>
  e.type === "content.deleted" ||
  (e.type === "content.state_changed" &&
    e.payload.state !== undefined &&
    e.payload.state !== "visible");

/**
 * Members mentioned by edits made while the content was hidden: those notices waited for the
 * approval. Members who already have a mention notice for the content from after it was hidden
 * (an edit job that ran after the approval) are left out.
 */
function heldMentions(ctx: Ctx, item: Content, history: PastEvent[]): number[] {
  const hiddenAt = history.findLast(madeHidden)?.id;
  if (hiddenAt === undefined) return [];
  const ids = history
    .filter((e) => e.type === "content.edited" && e.id > hiddenAt)
    .flatMap((e) => (Array.isArray(e.payload.newlyMentioned) ? e.payload.newlyMentioned : []));
  if (!ids.length) return [];
  const [refType, refId] =
    item.type === "thread" ? ["post", item.firstPostId ?? -1] : [item.type, item.id];
  const current = prepared(ctx, "notifications.heldMentions", () =>
    ctx.sqlite.prepare<{ user_id: number }, [string, number, string]>(
      "SELECT user_id FROM content_mentions WHERE content_type = ?1 AND content_id = ?2 AND user_id IN (SELECT value FROM json_each(?3))",
    ),
  )
    .all(refType, refId, JSON.stringify(ids))
    .map((row) => row.user_id);
  const notified = alreadyMentioned(ctx, item, current, hiddenAt);
  return current.filter((id) => !notified.has(id));
}

/**
 * Report events of the group's current cycle before `before` (a resolved or rejected group
 * reopens when it is reported again).
 */
function reportCycle(ctx: Ctx, groupId: number, before: number): PastEvent[] {
  const events = pastEvents(ctx, "report_group", groupId, before, [
    "report.created",
    "report.state_changed",
  ]);
  const closed = events.findLastIndex(
    (e) =>
      e.type === "report.state_changed" &&
      ["resolved", "rejected"].includes(String(e.payload.state)),
  );
  return events.slice(closed + 1);
}

function isFirstMessage(ctx: Ctx, item: Content): boolean {
  return (
    item.conversationId !== null &&
    prepared(ctx, "notifications.firstMessage", () =>
      ctx.sqlite.prepare<{ id: number }, [number]>(
        "SELECT id FROM conversation_messages WHERE conversation_id = ?1 ORDER BY id LIMIT 1",
      ),
    ).get(item.conversationId)?.id === item.id
  );
}

function moderationAction(event: DomainEvent): string {
  const p = event.payload;
  if (event.type === "content.deleted")
    return p.previousState === "moderated" ? "rejected" : "deleted";
  if (event.type === "content.state_changed")
    return p.previousState === "moderated" ? "approved" : "undeleted";
  if (typeof p.movedToNodeId === "number") return "moved";
  if (typeof p.isLocked === "boolean") return p.isLocked ? "locked" : "unlocked";
  return "edited";
}

/**
 * The recipient stages of an event, in precedence order: a member gets at most one notice per
 * event, from the first stage that delivers to them, so a member whose preference turns off a
 * higher stage falls through to the next one.
 */
function stages(ctx: Ctx, event: DomainEvent, item: Content | null): Stage[] {
  const p = event.payload;
  const result: Stage[] = [];
  if (event.type === "reaction.added" && typeof p.contentUserId === "number") {
    if (item?.state === "visible")
      result.push(
        source(
          "reaction",
          "content.reaction",
          "SELECT id AS user_id FROM users WHERE id = ?1 AND id > ?2 LIMIT ?3",
          p.contentUserId,
          { reactionTypeId: p.reactionTypeId },
        ),
      );
    return result;
  }
  if (event.type === "moderation.action") {
    if (p.notify === true && typeof p.contentUserId === "number")
      result.push(
        source(
          "moderation-action",
          "moderation.content",
          "SELECT id AS user_id FROM users WHERE id = ?1 AND id > ?2 LIMIT ?3",
          p.contentUserId,
          {
            action: p.action === "merge" ? "merged" : p.action,
            reason: p.reason,
            message: p.message,
          },
        ),
      );
    return result;
  }
  if (item) {
    if (p.notify === true && typeof p.actorId === "number" && p.actorId !== item.userId)
      result.push(
        source(
          "moderation-content",
          "moderation.content",
          "SELECT id AS user_id FROM users WHERE id = ?1 AND id > ?2 LIMIT ?3",
          item.userId,
          {
            action: moderationAction(event),
            reason: p.reason,
            message: p.message,
            movedToNodeId: p.movedToNodeId,
          },
        ),
      );
    if (event.type === "content.deleted") return result;
    if (item.type === "post" && item.position === 0 && event.type !== "content.edited")
      return result;
    const state = event.type === "content.created" ? stateAtCreation(ctx, event, item) : item.state;
    if (state === "moderated") {
      if (
        event.type === "content.created" &&
        !(item.type === "post" && item.id === item.firstPostId)
      )
        result.push(
          source(
            "approval",
            "moderator.approval",
            "SELECT id AS user_id FROM users WHERE permission_combination_id = ?1 AND id > ?2 ORDER BY id LIMIT ?3",
            0,
          ),
        );
      return result;
    }
    if (state !== "visible") return result;
    if (
      item.type === "conversation_message" &&
      event.type === "content.created" &&
      isFirstMessage(ctx, item)
    )
      return result;
    const approved = event.type === "content.state_changed" && p.previousState === "moderated";
    const history = approved ? contentHistory(ctx, event, item) : [];
    // An approval is new content only when the item was never visible before; approving an
    // edit that sent visible content to moderation delivers only the mentions the edit added.
    const isNew =
      event.type === "content.created" ||
      (approved && !history.some((e) => madeVisible(e) || e.payload.previousState === "visible"));
    if (approved && !isNew) {
      result.push(listed("mentions-held", "content.mentioned", heldMentions(ctx, item, history)));
      return result;
    }
    if (event.type === "content.edited") {
      // An approval job that ran first may already have delivered these held mentions.
      const stage = listed("mentions-edit", "content.mentioned", p.newlyMentioned);
      const notified = alreadyMentioned(ctx, item, stage.ids!, event.id);
      stage.ids = stage.ids!.filter((id) => !notified.has(id));
      result.push(stage);
    }
    if (!isNew) return result;
    result.push(
      source(
        "mentions",
        "content.mentioned",
        "SELECT user_id FROM content_mentions WHERE content_type = ?1 AND content_id = ?4 AND user_id > ?2 ORDER BY user_id LIMIT ?3",
        0,
      ),
    );
    result.push(
      source(
        "quotes",
        "content.quoted",
        "SELECT DISTINCT quoted_user_id AS user_id FROM content_quotes WHERE content_type = ?1 AND content_id = ?4 AND quoted_user_id > ?2 ORDER BY quoted_user_id LIMIT ?3",
        0,
      ),
    );
    if (item.type === "post" && item.id !== item.firstPostId && item.threadId && item.nodeId) {
      result.push(
        source(
          "thread",
          "thread.watched",
          "SELECT user_id FROM thread_watches WHERE thread_id = ?1 AND user_id > ?2 ORDER BY user_id LIMIT ?3",
          item.threadId,
        ),
      );
      result.push(
        source(
          "node-post",
          "node.post",
          "SELECT user_id FROM node_watches WHERE node_id = ?1 AND mode = 'posts' AND user_id > ?2 ORDER BY user_id LIMIT ?3",
          item.nodeId,
        ),
      );
    }
    if (item.type === "thread" && item.nodeId) {
      result.push(
        source(
          "node-thread",
          "node.thread",
          "SELECT user_id FROM node_watches WHERE node_id = ?1 AND user_id > ?2 ORDER BY user_id LIMIT ?3",
          item.nodeId,
        ),
      );
      result.push(
        source(
          "follow-thread",
          "member.thread",
          "SELECT user_id FROM user_follows WHERE followed_id = ?1 AND user_id > ?2 ORDER BY user_id LIMIT ?3",
          item.userId,
        ),
      );
    }
    if (item.type === "profile_post" && item.profileUserId)
      result.push(
        source(
          "profile",
          "profile.post",
          "SELECT id AS user_id FROM users WHERE id = ?1 AND id > ?2 LIMIT ?3",
          item.profileUserId,
        ),
      );
    if (item.type === "profile_post_comment" && item.parentId) {
      result.push(
        source(
          "profile-author",
          "profile.comment",
          "SELECT user_id FROM profile_posts WHERE id = ?1 AND user_id > ?2 LIMIT ?3",
          item.parentId,
        ),
      );
      result.push(
        source(
          "profile-commenters",
          "profile.commented",
          "SELECT DISTINCT user_id FROM profile_post_comments WHERE profile_post_id = ?1 AND user_id > ?2 ORDER BY user_id LIMIT ?3",
          item.parentId,
        ),
      );
    }
    if (item.type === "conversation_message" && item.conversationId && !isFirstMessage(ctx, item))
      result.push(
        source(
          "conversation",
          "conversation.message",
          "SELECT user_id FROM conversation_participants WHERE conversation_id = ?1 AND state = 'active' AND user_id > ?2 ORDER BY user_id LIMIT ?3",
          item.conversationId,
          { conversationId: item.conversationId },
        ),
      );
    return result;
  }
  if (event.type === "member.followed")
    result.push(
      source(
        "followed",
        "member.followed",
        "SELECT id AS user_id FROM users WHERE id = ?1 AND id > ?2 LIMIT ?3",
        event.targetId,
      ),
    );
  if (event.type === "member.groups_changed")
    result.push(
      source(
        "groups",
        "member.groups",
        "SELECT id AS user_id FROM users WHERE id = ?1 AND id > ?2 LIMIT ?3",
        event.targetId,
        { added: p.added, removed: p.removed },
      ),
    );
  if (
    ["member.warned", "member.restricted", "member.thread_banned"].includes(event.type) &&
    p.notify === true
  )
    result.push(
      source(
        "member-moderation",
        "moderation.member",
        "SELECT id AS user_id FROM users WHERE id = ?1 AND id > ?2 LIMIT ?3",
        event.targetId,
        {
          action:
            event.type === "member.warned"
              ? "warned"
              : event.type === "member.thread_banned"
                ? p.lifted === true
                  ? "thread_ban_lifted"
                  : "thread_banned"
                : p.lifted === true
                  ? "restriction_lifted"
                  : "restricted",
          reason: p.reason,
          message: p.message,
        },
      ),
    );
  if (event.type === "conversation.participants_added")
    result.push(
      listed("participants", "conversation.added", p.userIds, { conversationId: event.targetId }),
    );
  if (
    event.type === "report.state_changed" &&
    p.notify === true &&
    ["resolved", "rejected"].includes(String(p.state))
  )
    result.push(
      listed(
        "reporter",
        "report.resolved",
        reportCycle(ctx, event.targetId, event.id)
          .filter((e) => e.type === "report.created")
          .map((e) => e.payload.reporterId),
        { state: p.state, reason: p.reason, message: p.message },
      ),
    );
  if (
    event.type === "report.created" &&
    !reportCycle(ctx, event.targetId, event.id).some((e) => e.type === "report.created")
  )
    result.push(
      source(
        "report-moderators",
        "moderator.report",
        "SELECT id AS user_id FROM users WHERE permission_combination_id = ?1 AND id > ?2 ORDER BY id LIMIT ?3",
        0,
      ),
    );
  if (event.type === "announcement.published")
    result.push(
      source(
        "announcement",
        "announcement",
        "SELECT id AS user_id FROM users WHERE id > ?2 ORDER BY id LIMIT ?3",
        0,
      ),
    );
  return result;
}

/** Whether the content's current state still allows a stage to deliver. */
function deliverable(type: string, item: Content | null): boolean {
  if (type === "moderation.content") return true;
  if (type === "moderator.approval") return item?.state === "moderated";
  return item?.state === "visible";
}

function visible(ctx: Ctx, actor: Actor, item: Content | null, type: string): boolean {
  if (!item) return true;
  if (type === "moderation.content") return item.userId === actorUserId(actor);
  if (type === "moderator.approval") {
    if (item.conversationId !== null) return can(ctx, actor, "conversation.moderate");
    return item.nodeId !== null
      ? can(ctx, actor, "forum.approve", { nodeId: item.nodeId })
      : can(ctx, actor, "profilePost.approve");
  }
  if (item.state !== "visible") return false;
  if (item.nodeId !== null) return can(ctx, actor, "node.view", { nodeId: item.nodeId });
  if (item.conversationId !== null) return true;
  if (item.profileUserId !== null) return can(ctx, actor, "profile.view");
  return true;
}

function moderatorCombinations(
  ctx: Ctx,
  event: DomainEvent,
  item: Content | null,
  stage: Stage,
): string {
  const state = permissionState(ctx);
  const type = stage.type;
  if (type === "moderator.report")
    stage.reportTargetType = prepared(ctx, "notifications.reportTarget", () =>
      ctx.sqlite.prepare<{ target_type: string }, [number]>(
        "SELECT target_type FROM report_groups WHERE id = ?1",
      ),
    ).get(event.targetId)?.target_type;
  const nodeId = type === "moderator.report" ? event.payload.nodeId : item?.nodeId;
  const index = typeof nodeId === "number" ? (state.nodeIndex.get(nodeId) ?? -1) : -1;
  return JSON.stringify(
    allCombinations(ctx, state)
      .filter((combination) =>
        type === "moderator.report"
          ? stage.reportTargetType === "conversation_message"
            ? flagAt(combination, "conversation.moderate", -1)
            : index >= 0
              ? flagAt(combination, "forum.manageReports", index) ||
                flagAt(combination, "forum.approve", index)
              : flagAt(combination, "report.manageProfiles", -1) ||
                flagAt(combination, "profilePost.approve", -1)
          : item?.conversationId !== null && item?.conversationId !== undefined
            ? flagAt(combination, "conversation.moderate", -1)
            : index >= 0
              ? flagAt(combination, "forum.approve", index)
              : flagAt(combination, "profilePost.approve", -1),
      )
      .map((combination) => combination.id),
  );
}

function candidateRows(ctx: Ctx, item: Content | null, stage: Stage, after: number): number[] {
  if (stage.selector !== undefined) {
    const stmt = prepared(ctx, `notifications.stage.${stage.name}`, () =>
      ctx.sqlite.prepare<{ user_id: number }, [number, number, number]>(stage.sql),
    );
    return [
      ...new Set(
        (JSON.parse(stage.selector) as number[]).flatMap((id) =>
          stmt.all(id, after, BATCH).map((row) => row.user_id),
        ),
      ),
    ]
      .sort((a, b) => a - b)
      .slice(0, BATCH);
  }
  if (stage.ids)
    return prepared(ctx, "notifications.stage.list", () =>
      ctx.sqlite.prepare<{ user_id: number }, [string, number, number]>(LIST_SQL),
    )
      .all(JSON.stringify(stage.ids), after, BATCH)
      .map((row) => row.user_id);
  if (stage.name === "mentions" || stage.name === "quotes")
    return prepared(ctx, `notifications.stage.${stage.name}`, () =>
      ctx.sqlite.prepare<{ user_id: number }, [string, number, number, number]>(stage.sql),
    )
      .all(
        item?.type === "thread" ? "post" : (item?.type ?? ""),
        after,
        BATCH,
        item?.type === "thread" ? (item.firstPostId ?? -1) : (item?.id ?? -1),
      )
      .map((row) => row.user_id);
  return prepared(ctx, `notifications.stage.${stage.name}`, () =>
    ctx.sqlite.prepare<{ user_id: number }, [number, number, number]>(stage.sql),
  )
    .all(stage.sourceId, after, BATCH)
    .map((row) => row.user_id);
}

const READ_SUPPRESSED = ["thread.watched", "node.thread", "node.post", "member.thread"];

function deliverBatch(
  ctx: Ctx,
  event: DomainEvent,
  item: Content | null,
  stage: Stage,
  ids: number[],
): void {
  if (!ids.length) return;
  const encoded = JSON.stringify(ids);
  const recipients = prepared(ctx, "notifications.recipients", () =>
    ctx.sqlite.prepare<Recipient, [string]>(
      `SELECT u.id, u.group_id, u.notification_epoch, ${PRINCIPAL_COLUMNS} FROM users u WHERE u.id IN (SELECT value FROM json_each(?1))`,
    ),
  ).all(encoded);
  const contentType = item?.type ?? event.targetType;
  const contentId = item?.id ?? event.targetId;
  // Every stage of an event writes rows with its id, so a member gets one notice per event. Rows
  // written for this event are updated no earlier than the event itself (less an hour's margin for
  // clock steps), which bounds the seek to each member's recent rows; the content index would
  // read every notice of a hot post.
  const delivered = new Set(
    prepared(ctx, "notifications.delivered", () =>
      ctx.sqlite.prepare<{ user_id: number }, [string, number, number, string, number]>(
        "SELECT user_id FROM notifications INDEXED BY notifications_user_recent WHERE user_id IN (SELECT value FROM json_each(?1)) AND updated_at >= ?2 AND last_event_id = ?3 AND content_type = ?4 AND content_id = ?5",
      ),
    )
      .all(encoded, event.createdAt - CLOCK_MARGIN, event.id, contentType, contentId)
      .map((row) => row.user_id),
  );
  const groupKey =
    stage.type === "content.reaction"
      ? `reaction:${contentType}:${contentId}`
      : stage.type === "thread.watched"
        ? `thread:${item?.threadId}`
        : null;
  // Each member's open group row (unread, current epoch), and the members whose group row this
  // event or a later one already wrote (a replay). Both seek by member: a member's full history
  // can hold tens of thousands of rows.
  const currentGroups = new Map(
    groupKey
      ? prepared(ctx, "notifications.openGroups", () =>
          ctx.sqlite.prepare<
            {
              id: number;
              user_id: number;
              last_event_id: number;
              actor_ids: string;
              data: string;
            },
            [string, string]
          >(
            "SELECT n.id, n.user_id, n.last_event_id, n.actor_ids, n.data FROM json_each(?2) AS j CROSS JOIN users u ON u.id = j.value CROSS JOIN notifications n INDEXED BY notifications_user_group ON n.user_id = u.id AND n.epoch = u.notification_epoch AND n.group_key = ?1 AND n.read_at IS NULL",
          ),
        )
          .all(groupKey, encoded)
          .map((row) => [row.user_id, row])
      : [],
  );
  const replayedGroups = new Set(
    groupKey
      ? prepared(ctx, "notifications.replayedGroups", () =>
          ctx.sqlite.prepare<{ user_id: number }, [string, number, string, number]>(
            "SELECT user_id FROM notifications INDEXED BY notifications_user_recent WHERE user_id IN (SELECT value FROM json_each(?1)) AND updated_at >= ?2 AND group_key = ?3 AND last_event_id >= ?4",
          ),
        )
          .all(encoded, event.createdAt - CLOCK_MARGIN, groupKey, event.id)
          .map((row) => row.user_id)
      : [],
  );
  const actorId =
    item && event.type.startsWith("content.") && stage.type !== "moderation.content"
      ? item.userId
      : typeof event.payload.actorId === "number"
        ? event.payload.actorId
        : typeof event.payload.userId === "number"
          ? event.payload.userId
          : typeof event.payload.reporterId === "number"
            ? event.payload.reporterId
            : typeof event.payload.followerId === "number"
              ? event.payload.followerId
              : typeof event.payload.moderatorId === "number"
                ? event.payload.moderatorId
                : (item?.userId ?? null);
  // Moderator duty notices reach moderators even when they ignore the member involved.
  const duty = stage.type === "moderator.report" || stage.type === "moderator.approval";
  const ignored =
    actorId === null || duty
      ? new Set<number>()
      : new Set(
          prepared(ctx, "notifications.ignored", () =>
            ctx.sqlite.prepare<{ user_id: number }, [number, string]>(
              "SELECT user_id FROM user_ignores WHERE ignored_id = ?1 AND user_id IN (SELECT value FROM json_each(?2))",
            ),
          )
            .all(actorId, encoded)
            .map((row) => row.user_id),
        );
  const prefs = new Map(
    prepared(ctx, "notifications.preferences", () =>
      ctx.sqlite.prepare<{ user_id: number; in_app: number | null }, [string, string]>(
        "SELECT user_id, in_app FROM notification_preferences WHERE user_id IN (SELECT value FROM json_each(?1)) AND type = ?2",
      ),
    )
      .all(encoded, stage.type)
      .map((row) => [row.user_id, row.in_app]),
  );
  const defaultInApp =
    readSiteSettings(ctx).notificationDefaults[stage.type]?.inApp ??
    typeById.get(stage.type)!.defaults.inApp;
  const now = ctx.now();
  const versions = currentVersions(ctx);
  // Unread state uses post ids: a member who has read this post (or a later one) has seen it.
  const readPostId =
    item?.type === "post" ? item.id : item?.type === "thread" ? item.firstPostId : null;
  const alreadyRead =
    item?.threadId &&
    readPostId !== null &&
    READ_SUPPRESSED.includes(stage.type) &&
    (event.type === "content.created" || event.type === "content.state_changed")
      ? new Set(
          prepared(ctx, "notifications.alreadyRead", () =>
            ctx.sqlite.prepare<{ user_id: number }, [number, number, string]>(
              "SELECT user_id FROM thread_reads WHERE thread_id = ?1 AND last_read_post_id >= ?2 AND user_id IN (SELECT value FROM json_each(?3))",
            ),
          )
            .all(item.threadId, readPostId, encoded)
            .map((row) => row.user_id),
        )
      : null;
  const conversationId =
    item?.conversationId ??
    (event.type === "conversation.participants_added" ? event.targetId : null);
  const activeConversationUsers = conversationId
    ? new Set(
        prepared(ctx, "notifications.activeParticipants", () =>
          ctx.sqlite.prepare<{ user_id: number }, [number, string]>(
            "SELECT user_id FROM conversation_participants WHERE conversation_id = ?1 AND state = 'active' AND user_id IN (SELECT value FROM json_each(?2))",
          ),
        )
          .all(conversationId, encoded)
          .map((row) => row.user_id),
      )
    : null;
  const profilePrivacy = item?.profileUserId
    ? prepared(ctx, "notifications.profilePrivacy", () =>
        ctx.sqlite.prepare<{ profile_view_privacy: string }, [number]>(
          "SELECT profile_view_privacy FROM users WHERE id = ?1",
        ),
      ).get(item.profileUserId)?.profile_view_privacy
    : null;
  const profileFollowers =
    item?.profileUserId && profilePrivacy === "followed"
      ? new Set(
          prepared(ctx, "notifications.profileFollowers", () =>
            ctx.sqlite.prepare<{ followed_id: number }, [number, string]>(
              "SELECT followed_id FROM user_follows WHERE user_id = ?1 AND followed_id IN (SELECT value FROM json_each(?2))",
            ),
          )
            .all(item.profileUserId, encoded)
            .map((row) => row.followed_id),
        )
      : null;
  const actorRow =
    actorId === null || duty
      ? null
      : prepared(ctx, "notifications.actor", () =>
          ctx.sqlite.prepare<Recipient, [number]>(
            `SELECT u.id, u.group_id, u.notification_epoch, ${PRINCIPAL_COLUMNS} FROM users u WHERE u.id = ?1`,
          ),
        ).get(actorId);
  const ignorable = actorRow
    ? can(ctx, memberActor(actorRow.id, actorRow.group_id, actorRow, versions), "member.ignorable")
    : false;
  const movedToNodeId =
    typeof stage.data?.movedToNodeId === "number" ? stage.data.movedToNodeId : null;
  const updates: Array<{
    id: number;
    actorId: number | null;
    actorCount: number;
    actorIds: string;
    data: string;
    now: number;
    eventId: number;
    contentId: number;
    contentType: string;
    type: string;
  }> = [];
  const inserts: Array<{
    userId: number;
    epoch: number;
    type: string;
    contentType: string;
    contentId: number;
    threadId: number | null;
    actorId: number | null;
    actorIds: string;
    groupKey: string | null;
    data: string;
    eventId: number;
    now: number;
  }> = [];
  for (const row of recipients) {
    if (row.id === actorId || delivered.has(row.id)) continue;
    if (!(prefs.get(row.id) ?? defaultInApp)) continue;
    const recipient = memberActor(row.id, row.group_id, row, versions);
    if (row.banned_permanently || (row.banned_until !== null && row.banned_until > now)) continue;
    if (!can(ctx, recipient, "notification.view")) continue;
    if (!visible(ctx, recipient, item, stage.type)) continue;
    if (activeConversationUsers && !activeConversationUsers.has(row.id)) continue;
    if (alreadyRead?.has(row.id)) continue;
    if (
      item?.profileUserId &&
      row.id !== item.userId &&
      row.id !== item.profileUserId &&
      !can(ctx, recipient, "profile.bypassPrivacy") &&
      (profilePrivacy === "self" ||
        (profilePrivacy === "followed" && !profileFollowers?.has(row.id)))
    )
      continue;
    if (ignorable && ignored.has(row.id)) continue;
    if (stage.type === "moderator.report") {
      const nodeId = typeof event.payload.nodeId === "number" ? event.payload.nodeId : null;
      const allowed =
        stage.reportTargetType === "conversation_message"
          ? can(ctx, recipient, "conversation.moderate")
          : nodeId
            ? can(ctx, recipient, "forum.manageReports", { nodeId }) ||
              can(ctx, recipient, "forum.approve", { nodeId })
            : can(ctx, recipient, "report.manageProfiles") ||
              can(ctx, recipient, "profilePost.approve");
      if (!allowed) continue;
    }
    if (replayedGroups.has(row.id)) continue;
    const previous = currentGroups.get(row.id);
    if (previous) {
      if (previous.last_event_id >= event.id) continue;
      const oldData = JSON.parse(previous.data) as Record<string, unknown>;
      const seen =
        (oldData._actorIds as number[] | undefined) ?? (JSON.parse(previous.actor_ids) as number[]);
      const actors =
        actorId === null
          ? []
          : [
              actorId,
              ...(JSON.parse(previous.actor_ids) as number[]).filter((id) => id !== actorId),
            ].slice(0, 5);
      if (actorId !== null && !seen.includes(actorId)) seen.push(actorId);
      updates.push({
        id: previous.id,
        actorId,
        actorCount: seen.length,
        actorIds: JSON.stringify(actors),
        data: JSON.stringify({ ...oldData, _actorIds: seen }),
        now,
        eventId: event.id,
        contentId,
        contentType,
        type: stage.type,
      });
      delivered.add(row.id);
      continue;
    }
    const data = {
      ...stage.data,
      // Recipients who cannot view the destination node do not learn which node it is.
      ...(movedToNodeId !== null && !can(ctx, recipient, "node.view", { nodeId: movedToNodeId })
        ? { movedToNodeId: undefined }
        : {}),
      ...(item?.conversationId ? { conversationId: item.conversationId } : {}),
      ...(groupKey && actorId !== null ? { _actorIds: [actorId] } : {}),
      // The first reply of a thread group, so deleting the newest reply can fall back to it.
      ...(stage.type === "thread.watched" ? { _firstPostId: contentId } : {}),
    };
    inserts.push({
      userId: row.id,
      epoch: row.notification_epoch,
      type: stage.type,
      contentType,
      contentId,
      threadId: item?.threadId ?? null,
      actorId,
      actorIds: JSON.stringify(actorId === null ? [] : [actorId]),
      groupKey,
      data: JSON.stringify(data),
      eventId: event.id,
      now,
    });
    delivered.add(row.id);
  }
  if (updates.length)
    prepared(ctx, "notifications.groupUpdate", () =>
      ctx.sqlite.prepare<unknown, [string]>(
        "UPDATE notifications SET actor_id = json_extract(b.value, '$.actorId'), actor_count = json_extract(b.value, '$.actorCount'), actor_ids = json_extract(b.value, '$.actorIds'), data = json_extract(b.value, '$.data'), content_id = json_extract(b.value, '$.contentId'), content_type = json_extract(b.value, '$.contentType'), type = json_extract(b.value, '$.type'), updated_at = json_extract(b.value, '$.now'), last_event_id = json_extract(b.value, '$.eventId') FROM json_each(?1) AS b WHERE notifications.id = json_extract(b.value, '$.id')",
      ),
    ).run(JSON.stringify(updates));
  if (inserts.length) {
    const created = prepared(ctx, "notifications.insert", () =>
      ctx.sqlite.prepare<{ id: number; user_id: number }, [string]>(
        "INSERT INTO notifications (user_id, epoch, type, content_type, content_id, thread_id, actor_id, actor_count, actor_ids, group_key, data, last_event_id, created_at, updated_at) SELECT json_extract(value, '$.userId'), json_extract(value, '$.epoch'), json_extract(value, '$.type'), json_extract(value, '$.contentType'), json_extract(value, '$.contentId'), json_extract(value, '$.threadId'), json_extract(value, '$.actorId'), 1, json_extract(value, '$.actorIds'), json_extract(value, '$.groupKey'), json_extract(value, '$.data'), json_extract(value, '$.eventId'), json_extract(value, '$.now'), json_extract(value, '$.now') FROM json_each(?1) RETURNING id, user_id",
      ),
    ).all(JSON.stringify(inserts));
    prepared(ctx, "notifications.countUp", () =>
      ctx.sqlite.prepare<unknown, [string]>(
        "UPDATE users SET unread_notification_count = unread_notification_count + 1 WHERE id IN (SELECT value FROM json_each(?1))",
      ),
    ).run(JSON.stringify(created.map((row) => row.user_id)));
    publishEvent(ctx, {
      type: "notification.created",
      targetType: "notification",
      targetId: created[0]!.id,
      payload: {
        notificationIds: created.map((row) => row.id),
        userIds: created.map((row) => row.user_id),
      },
    });
  }
}

type UnreadRow = { id: number; user_id: number; epoch: number; current_epoch: number };

/** Lowers the unread counters for rows that stop being unread; older epochs already count as read. */
function countDown(ctx: Ctx, rows: UnreadRow[]): void {
  const counts = new Map<number, number>();
  for (const row of rows)
    if (row.epoch === row.current_epoch)
      counts.set(row.user_id, (counts.get(row.user_id) ?? 0) + 1);
  if (counts.size)
    prepared(ctx, "notifications.countDown", () =>
      ctx.sqlite.prepare<unknown, [string]>(
        "UPDATE users SET unread_notification_count = unread_notification_count - (SELECT json_extract(value, '$.n') FROM json_each(?1) WHERE json_extract(value, '$.id') = users.id) WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(?1))",
      ),
    ).run(JSON.stringify([...counts].map(([id, n]) => ({ id, n }))));
}

/**
 * Deletes unread notices for hidden content. With `regroup` (a deleted post), a thread-watch
 * group whose newest reply was the post moves to its newest remaining visible reply instead, and
 * is deleted only when no reply of the group remains.
 */
function deleteUnreadBatch(
  ctx: Ctx,
  type: string,
  id: number,
  eventId: number,
  after: number,
  regroup = false,
): number[] {
  const rows = prepared(ctx, "notifications.unreadForContent", () =>
    ctx.sqlite.prepare<
      UnreadRow & {
        type: string;
        data: string;
        thread_id: number | null;
        content_id: number;
        actor_ids: string;
      },
      [string, number, number, number]
    >(
      "SELECT n.id, n.user_id, n.epoch, u.notification_epoch AS current_epoch, n.type, n.data, n.thread_id, n.content_id, n.actor_ids FROM notifications n JOIN users u ON u.id = n.user_id WHERE n.content_type = ?1 AND n.content_id = ?2 AND n.id > ?4 AND n.read_at IS NULL AND n.last_event_id < ?3 ORDER BY n.id LIMIT 40",
    ),
  ).all(type, id, eventId, after);
  const removed: typeof rows = [];
  for (const row of rows) {
    const data = JSON.parse(row.data) as { _firstPostId?: unknown; _actorIds?: number[] };
    const first = data._firstPostId;
    const remaining =
      regroup && row.type === "thread.watched" && typeof first === "number" && row.thread_id
        ? prepared(ctx, "notifications.remainingReply", () =>
            ctx.sqlite.prepare<
              { id: number; user_id: number; position: number },
              [number, number, number, number]
            >(
              "SELECT id, user_id, position FROM posts WHERE thread_id = ?1 AND position >= (SELECT position FROM posts WHERE id = ?2) AND position < (SELECT position FROM posts WHERE id = ?3) AND id < ?3 AND id > coalesce((SELECT last_read_post_id FROM thread_reads WHERE user_id = ?4 AND thread_id = ?1), 0) AND state = 'visible' AND user_id != ?4 AND user_id NOT IN (SELECT ignored_id FROM user_ignores WHERE user_id = ?4) ORDER BY position DESC LIMIT 1",
            ),
          ).get(row.thread_id, first, row.content_id, row.user_id)
        : null;
    if (!remaining) {
      removed.push(row);
      continue;
    }
    // The deleted reply's author leaves the group unless another of their replies remains in it;
    // the fallback reply's author comes first, so actor_id matches the reply the row points to.
    const gone = prepared(ctx, "notifications.postAuthor", () =>
      ctx.sqlite.prepare<{ user_id: number }, [number]>("SELECT user_id FROM posts WHERE id = ?1"),
    ).get(row.content_id)?.user_id;
    const stays =
      gone === undefined ||
      gone === remaining.user_id ||
      !!prepared(ctx, "notifications.authorRemains", () =>
        ctx.sqlite.prepare<{ id: number }, [number, number, number, number, number]>(
          "SELECT id FROM posts WHERE thread_id = ?1 AND position >= (SELECT position FROM posts WHERE id = ?2) AND position <= ?3 AND user_id = ?4 AND state = 'visible' AND id > coalesce((SELECT last_read_post_id FROM thread_reads WHERE user_id = ?5 AND thread_id = ?1), 0) LIMIT 1",
        ),
      ).get(row.thread_id!, first as number, remaining.position, gone, row.user_id);
    const regrouped = (ids: number[]) => [
      remaining.user_id,
      ...ids.filter((id) => id !== remaining.user_id && (stays || id !== gone)),
    ];
    const actors = regrouped(JSON.parse(row.actor_ids) as number[]).slice(0, 5);
    const seen = regrouped(data._actorIds ?? actors);
    prepared(ctx, "notifications.repoint", () =>
      ctx.sqlite.prepare<unknown, [number, number, string, number, string, number]>(
        "UPDATE notifications SET content_id = ?1, actor_id = ?2, actor_ids = ?3, actor_count = ?4, data = ?5 WHERE id = ?6",
      ),
    ).run(
      remaining.id,
      remaining.user_id,
      JSON.stringify(actors),
      seen.length,
      JSON.stringify({ ...data, _actorIds: seen }),
      row.id,
    );
  }
  if (removed.length) {
    prepared(ctx, "notifications.deleteRows", () =>
      ctx.sqlite.prepare<unknown, [string]>(
        "DELETE FROM notifications WHERE id IN (SELECT value FROM json_each(?1))",
      ),
    ).run(JSON.stringify(removed.map((row) => row.id)));
    countDown(ctx, removed);
  }
  return rows.map((row) => row.id);
}

/** Marks one notice type of one content read for everyone, such as moderators' approval notices. */
function markReadBatch(
  ctx: Ctx,
  contentType: string,
  contentId: number,
  type: string,
  eventId: number,
  after: number,
): number[] {
  const rows = prepared(ctx, "notifications.unreadOfType", () =>
    ctx.sqlite.prepare<UnreadRow, [string, number, string, number, number]>(
      "SELECT n.id, n.user_id, n.epoch, u.notification_epoch AS current_epoch FROM notifications n JOIN users u ON u.id = n.user_id WHERE n.content_type = ?1 AND n.content_id = ?2 AND n.id > ?5 AND n.type = ?3 AND n.read_at IS NULL AND n.last_event_id < ?4 ORDER BY n.id LIMIT 40",
    ),
  ).all(contentType, contentId, type, eventId, after);
  if (rows.length) {
    prepared(ctx, "notifications.markRows", () =>
      ctx.sqlite.prepare<unknown, [number, string]>(
        "UPDATE notifications SET read_at = ?1 WHERE id IN (SELECT value FROM json_each(?2))",
      ),
    ).run(ctx.now(), JSON.stringify(rows.map((row) => row.id)));
    countDown(ctx, rows);
  }
  return rows.map((row) => row.id);
}

const saveProgress = (ctx: Ctx) =>
  prepared(ctx, "notifications.progress", () =>
    ctx.sqlite.prepare<unknown, [string, number, string]>(
      "UPDATE jobs SET payload = ?1, updated_at = ?2 WHERE unique_key = ?3",
    ),
  );

/**
 * Runs `step` in short transactions, each resuming after the last notification id the previous
 * one returned, until a batch comes back smaller than BATCH.
 */
async function inBatches(ctx: Ctx, step: (after: number) => number[]): Promise<void> {
  let after = 0;
  while (true) {
    const ids = writeTx(ctx, () => step(after));
    if (ids.length < BATCH) return;
    after = ids.at(-1)!;
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Deletes unread notices of several contents, about one batch of rows per transaction. */
async function deleteUnread(
  ctx: Ctx,
  type: string,
  ids: number[],
  eventId: number,
  regroup = false,
): Promise<void> {
  let index = 0;
  let after = 0;
  while (index < ids.length) {
    writeTx(ctx, () => {
      let budget = BATCH;
      while (index < ids.length && budget > 0) {
        const done = deleteUnreadBatch(ctx, type, ids[index]!, eventId, after, regroup);
        budget -= Math.max(done.length, 1);
        if (done.length < BATCH) {
          index++;
          after = 0;
        } else after = done.at(-1)!;
      }
    });
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function processEvent(ctx: Ctx, progress: Progress): Promise<void> {
  const event = eventRow(ctx, progress.eventId);
  if (!event) return;
  const item = content(ctx, event);
  if (event.type === "content.deleted") {
    await deleteUnread(
      ctx,
      event.targetType,
      [event.targetId],
      event.id,
      event.targetType === "post",
    );
    const children =
      event.targetType === "thread"
        ? {
            type: "post",
            sql: "SELECT id, position AS sort FROM posts WHERE thread_id = ?1 AND position > ?2 ORDER BY position LIMIT 100",
            start: -1,
          }
        : event.targetType === "profile_post"
          ? {
              type: "profile_post_comment",
              sql: "SELECT id, id AS sort FROM profile_post_comments WHERE profile_post_id = ?1 AND id > ?2 ORDER BY id LIMIT 100",
              start: 0,
            }
          : null;
    if (children) {
      let after = progress.deleteAfter ?? children.start;
      while (true) {
        const rows = prepared(ctx, `notifications.children.${children.type}`, () =>
          ctx.sqlite.prepare<{ id: number; sort: number }, [number, number]>(children.sql),
        ).all(event.targetId, after);
        if (!rows.length) break;
        const ids = rows.map((row) => row.id);
        await deleteUnread(ctx, children.type, ids, event.id);
        after = rows.at(-1)!.sort;
        writeTx(ctx, () => {
          saveProgress(ctx).run(
            JSON.stringify({ ...progress, deleteAfter: after }),
            ctx.now(),
            `notify:${event.id}`,
          );
        });
        if (rows.length < BATCH) break;
        await new Promise((resolve) => setImmediate(resolve));
      }
      progress.deleteAfter = after;
    }
  }
  // Moderators' duty notices clear once the duty is done.
  if (event.type === "content.state_changed" && item && item.state !== "moderated")
    await inBatches(ctx, (after) =>
      markReadBatch(ctx, item.type, item.id, "moderator.approval", event.id, after),
    );
  if (
    event.type === "report.state_changed" &&
    ["resolved", "rejected"].includes(String(event.payload.state))
  )
    await inBatches(ctx, (after) =>
      markReadBatch(ctx, "report_group", event.targetId, "moderator.report", event.id, after),
    );
  const phases = stages(ctx, event, item);
  for (const stage of phases)
    if (stage.type === "moderator.report" || stage.type === "moderator.approval")
      stage.selector = moderatorCombinations(ctx, event, item, stage);
  // Resume at the saved stage. When the stages changed since (the content changed state), start
  // over: delivery is idempotent per event.
  const resumed =
    progress.stage === undefined || phases[progress.phase]?.name === progress.stage
      ? progress.phase
      : -1;
  for (let phase = Math.max(resumed, 0); phase < phases.length; phase++) {
    const stage = phases[phase]!;
    let after = phase === resumed ? progress.after : 0;
    while (true) {
      const rows = writeTx(ctx, () => {
        // The content may have been hidden or moved since the event: re-read it per batch.
        const current = item ? content(ctx, event) : null;
        if (item && !deliverable(stage.type, current)) return null;
        if (stage.selector !== undefined && current && current.nodeId !== item?.nodeId)
          stage.selector = moderatorCombinations(ctx, event, current, stage);
        const ids = candidateRows(ctx, current, stage, after);
        deliverBatch(ctx, event, current, stage, ids);
        const next = ids.at(-1) ?? after;
        saveProgress(ctx).run(
          JSON.stringify({
            eventId: event.id,
            phase,
            after: next,
            deleteAfter: progress.deleteAfter,
            stage: stage.name,
          }),
          ctx.now(),
          `notify:${event.id}`,
        );
        return ids;
      });
      if (!rows || rows.length < BATCH) break;
      after = rows.at(-1)!;
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
}

export function registerNotificationJobs(ctx: Ctx): void {
  writeTx(ctx, () => {
    ctx.sqlite
      .prepare(
        "INSERT OR IGNORE INTO event_subscribers (name, last_event_id, updated_at) SELECT 'notifications', COALESCE(MAX(id), 0), ?1 FROM domain_events",
      )
      .run(ctx.now());
  });
  registerEventSubscriber(ctx, "notifications", (event) => {
    if (event.type === "notification.created") return;
    enqueueJob(
      ctx,
      "notifications.fanout",
      { eventId: event.id, phase: 0, after: 0 },
      { uniqueKey: `notify:${event.id}` },
    );
  });
  registerJobHandler(ctx, "notifications.fanout", (db, payload) =>
    processEvent(db, payload as Progress),
  );
  registerJobHandler(ctx, "notifications.markOldRead", async (db, payload) => {
    const { userId } = payload as { userId: number; epoch: number };
    while (true) {
      const size = writeTx(db, () => {
        const currentEpoch = prepared(db, "notifications.epoch", () =>
          db.sqlite.prepare<{ notification_epoch: number }, [number]>(
            "SELECT notification_epoch FROM users WHERE id = ?1",
          ),
        ).get(userId)?.notification_epoch;
        if (currentEpoch === undefined) return 0;
        const oldEpoch = prepared(db, "notifications.oldEpoch", () =>
          db.sqlite.prepare<{ epoch: number }, [number, number]>(
            "SELECT epoch FROM notifications WHERE user_id = ?1 AND epoch < ?2 AND read_at IS NULL ORDER BY epoch LIMIT 1",
          ),
        ).get(userId, currentEpoch)?.epoch;
        if (oldEpoch === undefined) return 0;
        const ids = prepared(db, "notifications.oldEpochRows", () =>
          db.sqlite.prepare<{ id: number }, [number, number]>(
            "SELECT id FROM notifications WHERE user_id = ?1 AND epoch = ?2 AND read_at IS NULL ORDER BY updated_at, id LIMIT 100",
          ),
        )
          .all(userId, oldEpoch)
          .map((row) => row.id);
        if (ids.length)
          prepared(db, "notifications.stampRead", () =>
            db.sqlite.prepare<unknown, [number, string]>(
              "UPDATE notifications SET read_at = ?1 WHERE id IN (SELECT value FROM json_each(?2)) AND read_at IS NULL",
            ),
          ).run(db.now(), JSON.stringify(ids));
        return ids.length;
      });
      if (size === 0) break;
      await new Promise((resolve) => setImmediate(resolve));
    }
  });
  registerJobHandler(ctx, "notifications.retention", async (db) => {
    await purgeReadNotifications(db);
  });
}

export async function purgeReadNotifications(ctx: Ctx): Promise<number> {
  const cutoff = ctx.now() - readSiteSettings(ctx).notificationRetentionDays * 86_400_000;
  let deleted = 0;
  while (true) {
    const size = writeTx(ctx, () => {
      const rows = prepared(ctx, "notifications.purge", () =>
        ctx.sqlite.prepare<{ id: number }, [number]>(
          "SELECT id FROM notifications WHERE read_at IS NOT NULL AND read_at < ?1 ORDER BY read_at, id LIMIT 40",
        ),
      ).all(cutoff);
      if (rows.length)
        prepared(ctx, "notifications.deleteRows", () =>
          ctx.sqlite.prepare<unknown, [string]>(
            "DELETE FROM notifications WHERE id IN (SELECT value FROM json_each(?1))",
          ),
        ).run(JSON.stringify(rows.map((row) => row.id)));
      return rows.length;
    });
    deleted += size;
    if (size < BATCH) return deleted;
    await new Promise((resolve) => setImmediate(resolve));
  }
}
