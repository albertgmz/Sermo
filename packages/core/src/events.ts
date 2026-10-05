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

export interface DomainEvent {
  id: number;
  type: ContentEventType;
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
        type: ContentEventType;
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
