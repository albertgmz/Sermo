import type { Ctx } from "../context";
import { prepared } from "../context";

export interface UserSummaryRow {
  id: number;
  username: string;
}

const DELETED_USER = (id: number): UserSummaryRow => ({ id, username: `User #${id}` });

/**
 * Batch-loads user summaries for a page of items in one query (no N+1).
 * Missing ids map to a placeholder so callers never have to handle undefined.
 */
export function loadUserSummaries(ctx: Ctx, ids: Iterable<number>): (id: number) => UserSummaryRow {
  const unique = [...new Set(ids)];
  const map = new Map<number, UserSummaryRow>();
  if (unique.length > 0) {
    const stmt = prepared(ctx, "shared.userSummaries", () =>
      ctx.sqlite.prepare<UserSummaryRow, [string]>(
        "SELECT id, username FROM users WHERE id IN (SELECT value FROM json_each(?1))",
      ),
    );
    for (const row of stmt.all(JSON.stringify(unique))) map.set(row.id, row);
  }
  return (id) => map.get(id) ?? DELETED_USER(id);
}
