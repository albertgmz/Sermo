import { type Ctx, prepared } from "../../context";
import { iso } from "../../time";
import { contentAuthor } from "../forums/guest-author";

/** The kinds of content whose deletion is shown to the staff who may see it deleted. */
export type DeletionTarget =
  | "post"
  | "conversation_message"
  | "profile_post"
  | "profile_post_comment";

/** Who hid an item and why, as its newest deletion event recorded it. */
export type DeletionRow = { actorId: number | null; reason: string; at: number };

// One statement per kind, the kind written in (it is one of a fixed few, never input).
const deletionsSql = (targetType: DeletionTarget) =>
  `SELECT id, target_id, payload, created_at FROM domain_events WHERE target_type = '${targetType}' AND target_id IN (SELECT value FROM json_each(?1)) AND type = 'content.deleted'`;

/**
 * The newest `content.deleted` event of each given item of one kind, from one indexed lookup. An
 * event carries the actor and the reason only when someone other than the author acted, so a
 * missing actor means the author hid their own item. That holds only while every delete driven by
 * someone else (a moderator, a bulk action, a spam cleanup) publishes its actor. Callers pass
 * only the deleted items the viewer may see deleted.
 */
export function loadDeletions(
  ctx: Ctx,
  targetType: DeletionTarget,
  ids: number[],
): Map<number, DeletionRow> {
  const found = new Map<number, DeletionRow>();
  if (ids.length === 0) return found;
  const rows = prepared(ctx, `moderation.deletions.${targetType}`, () =>
    ctx.sqlite.prepare<
      { id: number; target_id: number; payload: string; created_at: number },
      [string]
    >(deletionsSql(targetType)),
  ).all(JSON.stringify(ids));
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

/** The ids of the deleters to load with a page's authors (the authors who hid their own are there already). */
export function deleterIds(deletions: Map<number, DeletionRow>): number[] {
  return [...deletions.values()].flatMap((deletion) =>
    deletion.actorId === null ? [] : [deletion.actorId],
  );
}

/** A deletion as the contracts give it (`PostDeletion`), or null when none was loaded. */
export function deletionValue(
  deletion: DeletionRow | undefined,
  users: (id: number) => { id: number; username: string },
  authorId: number,
) {
  return deletion
    ? {
        by: contentAuthor(users, deletion.actorId ?? authorId, null),
        reason: deletion.reason,
        at: iso(deletion.at),
      }
    : null;
}
