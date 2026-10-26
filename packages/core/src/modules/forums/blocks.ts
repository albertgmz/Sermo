import type { Actor } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { blockedAmong } from "../social/blocks";

/**
 * Forums under a block: threads started by a member in a block with the viewer are left out of
 * lists and not found, their posts are left out of threads, and where such a member posted last
 * the viewer sees the newest post before theirs.
 */
export const forumBlockSql = {
  /** Visible posts of a thread before a position, newest first (`posts_thread_position`). */
  olderPosts:
    "SELECT id, user_id, position, created_at, guest_name FROM posts WHERE thread_id = ?1 AND state = 'visible' AND position < ?2 ORDER BY position DESC LIMIT ?3",
  starters: "SELECT id, user_id FROM threads WHERE id IN (SELECT value FROM json_each(?1))",
} as const;

export type SeenPost = {
  id: number;
  user_id: number;
  position: number;
  created_at: number;
  guest_name: string | null;
};

const BATCH = 20;
/** How many posts back a thread is searched; past it, the opening post stands in. */
const LOOKBACK = 100;

/**
 * For the threads of a page whose newest post is by a member in a block with the viewer, the
 * newest visible post before it by anyone else (the opening post when none is found within
 * `LOOKBACK` posts: its author is never in a block with the viewer, or the thread is not listed).
 * Nothing is read for a page with no such thread beyond one query.
 */
export function seenLastPosts<Row extends { id: number; last_poster_id: number }>(
  ctx: Ctx,
  actor: Actor,
  rows: Row[],
  positionOf: (row: Row) => number,
): Map<number, SeenPost> {
  const result = new Map<number, SeenPost>();
  const blocked = blockedAmong(
    ctx,
    actor,
    rows.map((row) => row.last_poster_id),
  );
  if (blocked.size === 0) return result;
  const older = prepared(ctx, "forums.blocks.olderPosts", () =>
    ctx.sqlite.prepare<SeenPost, [number, number, number]>(forumBlockSql.olderPosts),
  );
  for (const row of rows) {
    if (!blocked.has(row.last_poster_id)) continue;
    let before = positionOf(row);
    for (let looked = 0; looked < LOOKBACK && before > 0; looked += BATCH) {
      const batch = older.all(row.id, before, BATCH);
      const hidden = blockedAmong(
        ctx,
        actor,
        batch.map((post) => post.user_id),
      );
      const found = batch.find((post) => !hidden.has(post.user_id));
      if (found) {
        result.set(row.id, found);
        break;
      }
      if (batch.length < BATCH) break;
      before = batch.at(-1)!.position;
    }
    if (!result.has(row.id)) {
      const first = older.all(row.id, 1, 1)[0];
      if (first) result.set(row.id, first);
    }
  }
  return result;
}

/** The starters of a page of threads, by thread id. One query. */
export function threadStarters(ctx: Ctx, ids: number[]): Map<number, number> {
  if (ids.length === 0) return new Map();
  return new Map(
    prepared(ctx, "forums.blocks.starters", () =>
      ctx.sqlite.prepare<{ id: number; user_id: number }, [string]>(forumBlockSql.starters),
    )
      .all(JSON.stringify(ids))
      .map((row) => [row.id, row.user_id] as const),
  );
}
