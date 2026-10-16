import type * as z from "zod";
import { type Actor, actorUserId } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { FEED_UNREAD_CAP, type FeedUnread } from "../../contracts/feed";
import { readGates } from "../forums";

export const unreadSql = {
  /**
   * The first `?3` posts the viewer may see after the last one they read, for each thread of the
   * list `?1`: one seek of `posts_thread_position` per thread, from the position stored in the
   * viewer's `thread_reads` row (one seek of its unique index; no row means from the start).
   */
  firstUnread:
    "SELECT p.thread_id, p.id, p.position FROM json_each(?1) AS j CROSS JOIN posts p WHERE p.id IN (SELECT p2.id FROM posts p2 WHERE p2.thread_id = j.value AND p2.state = 'visible' AND p2.position > COALESCE((SELECT r.last_read_position FROM thread_reads r WHERE r.user_id = ?2 AND r.thread_id = j.value), -1) ORDER BY p2.position LIMIT ?3)",
};

type UnreadValue = z.infer<typeof FeedUnread>;

/**
 * What the viewer has not read of each of these threads (the threads of a page of the feed that
 * are unread for them, by `isUnread`): one statement for the page, never one per card. A thread
 * whose posts the viewer may not read (titles only) has no entry, and neither has a thread whose
 * unread posts the statement does not find (a read mark that no longer matches the thread).
 */
export function unreadIn(
  ctx: Ctx,
  actor: Actor,
  threads: { id: number; nodeId: number; isUnread: boolean }[],
): Map<number, UnreadValue> {
  const userId = actorUserId(actor);
  const result = new Map<number, UnreadValue>();
  if (userId === null) return result;
  const gates = readGates(ctx, actor);
  const ids = threads
    .filter((thread) => thread.isUnread && gates.readsOthers(thread.nodeId))
    .map((thread) => thread.id);
  if (ids.length === 0) return result;
  const rows = prepared(ctx, "feed.firstUnread", () =>
    ctx.sqlite.prepare<
      { thread_id: number; id: number; position: number },
      [string, number, number]
    >(unreadSql.firstUnread),
  ).all(JSON.stringify(ids), userId, FEED_UNREAD_CAP + 1);
  const byThread = new Map<number, { id: number; position: number }[]>();
  for (const row of rows) {
    const list = byThread.get(row.thread_id) ?? [];
    list.push(row);
    byThread.set(row.thread_id, list);
  }
  for (const [threadId, posts] of byThread) {
    const first = posts.reduce((a, b) => (b.position < a.position ? b : a));
    result.set(threadId, {
      count: Math.min(posts.length, FEED_UNREAD_CAP),
      more: posts.length > FEED_UNREAD_CAP,
      firstPostId: first.id,
      firstPosition: first.position,
    });
  }
  return result;
}
