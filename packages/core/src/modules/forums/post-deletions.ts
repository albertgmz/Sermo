import { type Ctx, prepared } from "../../context";

/** Who hid a post and why, as its newest deletion event recorded it. */
export type PostDeletionRow = { actorId: number | null; reason: string; at: number };

/**
 * The newest `content.deleted` event of each given post, from one indexed lookup. An event
 * carries the actor and the reason only when someone other than the author acted, so a missing
 * actor means the author hid their own post. That holds only while every delete driven by
 * someone else (a moderator, a bulk action, a spam cleanup) publishes its actor.
 */
export function loadPostDeletions(ctx: Ctx, postIds: number[]): Map<number, PostDeletionRow> {
  const found = new Map<number, PostDeletionRow>();
  if (postIds.length === 0) return found;
  const rows = prepared(ctx, "forums.postDeletions", () =>
    ctx.sqlite.prepare<
      { id: number; target_id: number; payload: string; created_at: number },
      [string]
    >(
      "SELECT id, target_id, payload, created_at FROM domain_events WHERE target_type = 'post' AND target_id IN (SELECT value FROM json_each(?1)) AND type = 'content.deleted'",
    ),
  ).all(JSON.stringify(postIds));
  const newest = new Map<number, number>();
  for (const row of rows) {
    if ((newest.get(row.target_id) ?? 0) > row.id) continue;
    newest.set(row.target_id, row.id);
    const payload = JSON.parse(row.payload) as { actorId?: unknown; reason?: unknown };
    found.set(row.target_id, {
      actorId: typeof payload.actorId === "number" ? payload.actorId : null,
      reason: typeof payload.reason === "string" ? payload.reason : "",
      at: row.created_at,
    });
  }
  return found;
}
