import { type Actor, actorUserId } from "../actor";
import type { Ctx } from "../context";
import { prepared } from "../context";
import type { ReactionContentType } from "../db/schema";

export interface ReactionSummaryValue {
  counts: Record<string, number>;
  total: number;
  mine: number | null;
}

/**
 * Loads the viewer's own reaction (type id) for a page of items in one query.
 * Returns an empty map for guests. Reads never aggregate the reactions table; counts come from
 * each row's denormalized `reaction_counts`.
 */
export function loadViewerReactions(
  ctx: Ctx,
  actor: Actor,
  contentType: ReactionContentType,
  contentIds: readonly number[],
): Map<number, number> {
  const userId = actorUserId(actor);
  const result = new Map<number, number>();
  if (userId === null || contentIds.length === 0) return result;
  const stmt = prepared(ctx, "shared.viewerReactions", () =>
    ctx.sqlite.prepare<{ content_id: number; reaction_type_id: number }, [string, number, string]>(
      "SELECT content_id, reaction_type_id FROM reactions " +
        "WHERE content_type = ?1 AND user_id = ?2 AND content_id IN (SELECT value FROM json_each(?3))",
    ),
  );
  for (const row of stmt.all(contentType, userId, JSON.stringify(contentIds))) {
    result.set(row.content_id, row.reaction_type_id);
  }
  return result;
}

/** Builds a ReactionSummary from a row's `reaction_counts` JSON and the viewer's reaction. */
export function reactionSummary(
  reactionCountsJson: string,
  mine: number | undefined,
): ReactionSummaryValue {
  const counts = parseReactionCounts(reactionCountsJson);
  let total = 0;
  for (const n of Object.values(counts)) total += n;
  return { counts, total, mine: mine ?? null };
}

export function parseReactionCounts(json: string): Record<string, number> {
  const parsed = JSON.parse(json) as Record<string, number>;
  for (const key of Object.keys(parsed)) {
    if (!(parsed[key]! > 0)) delete parsed[key];
  }
  return parsed;
}
