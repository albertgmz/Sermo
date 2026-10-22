import { requireAuthenticated } from "../../actor";
import { type Ctx, prepared } from "../../context";
import * as contracts from "../../contracts/forums";
import { writeTx } from "../../db/tx";
import { NotFoundError } from "../../errors";
import { implement, markPublic } from "../../operation";
import { getNodeTree, requirePermission, viewableNodeIds } from "../../permissions";
import { iso } from "../../time";
import { requireSiteView } from "../members/site-access";

/** After this long every thread counts as read. */
const UNREAD_WINDOW_MS = 30 * 86_400_000;

export const readMarkSql = {
  /** The markers of one viewer for a set of forums: one seek of `node_reads_user_node` each. */
  marks:
    "SELECT node_id, read_at FROM node_reads WHERE user_id = ?1 AND node_id IN (SELECT value FROM json_each(?2))",
  /** Marks the forums in `?2` read at `?3`; a marker never moves back. */
  mark: "INSERT INTO node_reads (user_id, node_id, read_at) SELECT ?1, value, ?3 FROM json_each(?2) WHERE true ON CONFLICT (user_id, node_id) DO UPDATE SET read_at = max(read_at, excluded.read_at)",
  /** The first post made after a marker: one seek of `posts_thread_created`. */
  after:
    "SELECT position FROM posts WHERE thread_id = ?1 AND created_at > ?2 ORDER BY created_at LIMIT 1",
  /** The forums among `?1` with a post newer than `?2`: a marker on any other holds nothing. */
  recent:
    "SELECT id FROM nodes WHERE id IN (SELECT value FROM json_each(?1)) AND last_post_at > ?2",
  /** Removes a batch of the markers older than `?1`: an index range of `node_reads_read_at`. */
  expire:
    "DELETE FROM node_reads WHERE id IN (SELECT id FROM node_reads WHERE read_at < ?1 ORDER BY read_at LIMIT 1000)",
};

/**
 * When the member marked each of these forums read (epoch ms); a forum without a marker has no
 * entry. A thread whose last post is not newer than its forum's marker counts as read. One
 * statement for a whole page, whatever the number of threads.
 */
export const readMarksOf = markPublic(
  "Reads only the viewer's own markers; callers pass the viewer's id.",
  function readMarksOf(
    ctx: Ctx,
    userId: number | null,
    nodeIds: Iterable<number>,
  ): Map<number, number> {
    const marks = new Map<number, number>();
    const ids = [...new Set(nodeIds)];
    if (userId === null || ids.length === 0) return marks;
    const rows = prepared(ctx, "forums.readMarks", () =>
      ctx.sqlite.prepare<{ node_id: number; read_at: number }, [number, string]>(readMarkSql.marks),
    ).all(userId, JSON.stringify(ids));
    for (const row of rows) marks.set(row.node_id, row.read_at);
    return marks;
  },
);

/**
 * The position after which a thread's posts were made after the member's marker for its forum
 * (-1 for no marker, so every post counts). Positions follow creation order, so the first post
 * newer than the marker starts the unread ones: one seek, however long the thread is.
 */
export const positionBeforeMark = markPublic(
  "Reads positions of a thread the caller has already opened for the viewer.",
  function positionBeforeMark(ctx: Ctx, threadId: number, mark: number | undefined): number {
    if (mark === undefined) return -1;
    const first = prepared(ctx, "forums.postAfterMark", () =>
      ctx.sqlite.prepare<{ position: number }, [number, number]>(readMarkSql.after),
    ).get(threadId, mark);
    return first ? first.position - 1 : Number.MAX_SAFE_INTEGER;
  },
);

/** Removes one batch of markers past the unread window; true when a full batch went. */
export function expireReadMarks(ctx: Ctx, olderThan: number): boolean {
  return (
    writeTx(ctx, () =>
      prepared(ctx, "forums.expireReadMarks", () => ctx.sqlite.prepare(readMarkSql.expire)).run(
        olderThan,
      ),
    ).changes >= 1000
  );
}

/** Marks the forums read for the member, now, in one statement. */
function markForums(ctx: Ctx, userId: number, nodeIds: readonly number[]) {
  // The time is taken once the write lock is held: a post committed while this waited for it is
  // newer than the marker only if it was made after the member's view.
  const readAt = nodeIds.length
    ? writeTx(ctx, () => {
        const now = ctx.now();
        prepared(ctx, "forums.markRead", () => ctx.sqlite.prepare(readMarkSql.mark)).run(
          userId,
          JSON.stringify(nodeIds),
          now,
        );
        return now;
      })
    : ctx.now();
  return { readAt: iso(readAt), forums: nodeIds.length };
}

export const nodesMarkReadOp = implement(contracts.nodesMarkRead, (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  const tree = getNodeTree(ctx);
  if (!tree.get(input.nodeId)) throw new NotFoundError();
  requirePermission(ctx, actor, "node.view", { nodeId: input.nodeId }, { notFound: true });
  requireSiteView(ctx, actor);
  const viewable = new Set(viewableNodeIds(ctx, actor));
  const forums = tree
    .subtreeIds(input.nodeId)
    .filter((id) => viewable.has(id) && tree.get(id)?.type === "forum");
  return markForums(ctx, user.userId, forums);
});

export const nodesMarkAllReadOp = implement(contracts.nodesMarkAllRead, (ctx, actor) => {
  const user = requireAuthenticated(actor);
  requireSiteView(ctx, actor);
  const tree = getNodeTree(ctx);
  const forums = viewableNodeIds(ctx, actor).filter((id) => tree.get(id)?.type === "forum");
  // Only forums with a post inside the unread window can hold an unread thread: marking the
  // others would store a row per forum and member that never matters.
  const recent = prepared(ctx, "forums.recentNodes", () =>
    ctx.sqlite.prepare<{ id: number }, [string, number]>(readMarkSql.recent),
  ).all(JSON.stringify(forums), ctx.now() - UNREAD_WINDOW_MS);
  return markForums(
    ctx,
    user.userId,
    recent.map((row) => row.id),
  );
});
