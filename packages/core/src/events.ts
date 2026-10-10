import type { Ctx } from "./context";
import { prepared } from "./context";
import { writeTx } from "./db/tx";

export const CONTENT_EVENT_TYPES = [
  "content.created",
  "content.edited",
  "content.deleted",
  "content.state_changed",
] as const;

export type ContentEventType = (typeof CONTENT_EVENT_TYPES)[number];

/**
 * Every event type. Content events carry the content as target. The others, with their target
 * and payload:
 * - `reaction.added`: target the reacted content (targetType is the reaction content type);
 *   payload { userId, contentUserId, reactionTypeId }.
 * - `member.groups_changed`: target the member (targetType "user"); payload { added, removed,
 *   source: "promotion" | "admin" | "verification", promotionId?, actorId? }; "verification"
 *   is a confirmed email moving the member from Unconfirmed to Member.
 * - `member.followed`: target the followed member; payload { followerId }.
 * - `member.warned`, `member.banned`, `member.restricted`, `member.thread_banned`: target the
 *   member; payload { moderatorId, reason, expiresAt?, notify, message?, ...details }. Lifting a
 *   ban or restriction publishes the same type with `lifted: true`.
 * - Moderation actions on content that already publish a `content.*` event (delete, restore,
 *   approve, edit, move, lock) add { actorId, reason, notify, message? } to that event's payload
 *   instead of publishing a second event.
 * - `moderation.action`: only for actions without a content event (merge, split): target the
 *   content; payload { action, moderatorId, contentUserId, reason, notify, message?, ... }.
 * - `report.created`, `report.state_changed`: target the report group; payload { reporterId?,
 *   state?, moderatorId?, nodeId? }.
 * - `conversation.participants_added`: target the conversation; payload { userIds, actorId }.
 * - `announcement.published`: target the announcement; payload { userId }.
 * - `notification.created`: one per fan-out batch, target the first notification; payload
 *   { notificationIds, userIds } (for future real-time delivery).
 */
export const EVENT_TYPES = [
  ...CONTENT_EVENT_TYPES,
  "reaction.added",
  "member.groups_changed",
  "member.followed",
  "member.warned",
  "member.banned",
  "member.restricted",
  "member.thread_banned",
  "moderation.action",
  "report.created",
  "report.state_changed",
  "conversation.participants_added",
  "announcement.published",
  "notification.created",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface DomainEvent {
  id: number;
  type: EventType;
  targetType: string;
  targetId: number;
  payload: Record<string, unknown>;
  createdAt: number;
}

type EventInput = Pick<DomainEvent, "type" | "targetType" | "targetId"> & {
  payload?: Record<string, unknown>;
};

/** Call inside the content write transaction. The event becomes visible only on commit. */
export function publishEvent(ctx: Ctx, event: EventInput): number {
  if (!ctx.sqlite.inTransaction) throw new Error("publishEvent requires a write transaction");
  const result = prepared(ctx, "events.publish", () =>
    ctx.sqlite.prepare<unknown, [string, string, number, string, number]>(
      "INSERT INTO domain_events (type, target_type, target_id, payload, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    ),
  ).run(
    event.type,
    event.targetType,
    event.targetId,
    JSON.stringify(event.payload ?? {}),
    ctx.now(),
  );
  return Number(result.lastInsertRowid);
}

/**
 * Durable subscriber cursor. A failed handler leaves the event pending for retry. Handlers must
 * be idempotent because a crash can occur after their side effect and before the cursor commit.
 */
export async function consumeEvents(
  ctx: Ctx,
  subscriber: string,
  handler: (event: DomainEvent) => void | Promise<void>,
  limit = 100,
): Promise<number> {
  if (!subscriber || limit < 1 || limit > 1000)
    throw new Error("Invalid event subscriber or limit");
  const cursor =
    prepared(ctx, "events.cursor", () =>
      ctx.sqlite.prepare<{ last_event_id: number }, [string]>(
        "SELECT last_event_id FROM event_subscribers WHERE name = ?1",
      ),
    ).get(subscriber)?.last_event_id ?? 0;
  const rows = prepared(ctx, "events.next", () =>
    ctx.sqlite.prepare<
      {
        id: number;
        type: EventType;
        target_type: string;
        target_id: number;
        payload: string;
        created_at: number;
      },
      [number, number]
    >(
      "SELECT id, type, target_type, target_id, payload, created_at FROM domain_events WHERE id > ?1 ORDER BY id LIMIT ?2",
    ),
  ).all(cursor, limit);
  for (const row of rows) {
    await handler({
      id: row.id,
      type: row.type,
      targetType: row.target_type,
      targetId: row.target_id,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
      createdAt: row.created_at,
    });
    writeTx(ctx, () => {
      ctx.sqlite
        .prepare(
          "INSERT INTO event_subscribers (name, last_event_id, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT (name) DO UPDATE SET last_event_id = MAX(last_event_id, excluded.last_event_id), updated_at = excluded.updated_at",
        )
        .run(subscriber, row.id, ctx.now());
    });
  }
  return rows.length;
}

type EventHandler = (event: DomainEvent) => void | Promise<void>;
const subscribers = new WeakMap<Ctx, Map<string, EventHandler>>();

/**
 * Registers a subscriber that `dispatchEvents` feeds promptly (the server dispatches every
 * second). The name is its durable cursor; handlers must be idempotent.
 */
export function registerEventSubscriber(ctx: Ctx, name: string, handler: EventHandler): void {
  const map = subscribers.get(ctx) ?? new Map<string, EventHandler>();
  map.set(name, handler);
  subscribers.set(ctx, map);
}

/**
 * Feeds new events to every registered subscriber in batches, yielding to the event loop between
 * batches so requests are never held up, until each is caught up or the time budget is spent.
 * Returns the number of events handled.
 */
export async function dispatchEvents(
  ctx: Ctx,
  options: { budgetMs?: number } = {},
): Promise<number> {
  const deadline = performance.now() + (options.budgetMs ?? 500);
  let handled = 0;
  for (const [name, handler] of subscribers.get(ctx) ?? []) {
    while (performance.now() < deadline) {
      const count = await consumeEvents(ctx, name, handler, 100);
      handled += count;
      await new Promise((resolve) => setImmediate(resolve));
      if (count < 100) break;
    }
  }
  return handled;
}
