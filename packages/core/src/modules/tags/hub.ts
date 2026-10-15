import { type Actor, actorUserId } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { markPublic } from "../../operation";
import { permissionsOf, viewableNodeIds } from "../../permissions";
import { type ThreadRow, threadColumns } from "../forums";
import { readGates } from "../forums/read-gates";

/**
 * The threads of one tag in activity order, as a thread list shows them. The index
 * `thread_tags_hub` gives the order (its `sort_at` follows the thread's, kept by a trigger), the
 * thread row is one primary-key seek per row, and the viewer's reach is four lists of forums:
 * - `?4` forums whose other-member threads the viewer may open,
 * - `?5` forums where only their own threads are open to them,
 * - `?6` forums where they may see moderated threads, `?7` where they may see deleted ones.
 * `?8` is the viewer (-1 for a guest), `?2`/`?3` the cursor and `?9` the number of rows.
 */
export const hubSql = (): string =>
  `SELECT ${threadColumns
    .split(", ")
    .map((column) => `t.${column}`)
    .join(
      ", ",
    )} FROM thread_tags tt INDEXED BY thread_tags_hub JOIN threads t ON t.id = tt.thread_id ` +
  "WHERE tt.tag_id = ?1 AND (tt.sort_at, tt.thread_id) < (?2, ?3) AND t.merged_into_id IS NULL " +
  "AND (t.node_id IN (SELECT value FROM json_each(?4)) " +
  "OR (t.user_id = ?8 AND t.node_id IN (SELECT value FROM json_each(?5)))) " +
  "AND (t.state = 'visible' " +
  "OR (t.state = 'moderated' AND (t.user_id = ?8 OR t.node_id IN (SELECT value FROM json_each(?6)))) " +
  "OR (t.state = 'deleted' AND t.node_id IN (SELECT value FROM json_each(?7)))) " +
  "ORDER BY tt.sort_at DESC, tt.thread_id DESC LIMIT ?9";

/**
 * Up to `limit` threads carrying the tag that the viewer may see, after `cursor`
 * (`[sort_at, thread id]` of the last row of the page before). Callers check the site is open.
 */
export const hubThreads = markPublic(
  "Applies the viewer's own reach: viewable forums, read gates, hidden states.",
  function hubThreads(
    ctx: Ctx,
    actor: Actor,
    tagId: number,
    cursor: readonly [number, number] | null,
    limit: number,
  ): ThreadRow[] {
    const permissions = permissionsOf(ctx, actor);
    const gates = readGates(ctx, actor);
    const open: number[] = [];
    const own: number[] = [];
    const moderated: number[] = [];
    const deleted: number[] = [];
    for (const nodeId of viewableNodeIds(ctx, actor)) {
      (gates.opensOthers(nodeId) ? open : own).push(nodeId);
      if (permissions.can("forum.viewModerated", { nodeId })) moderated.push(nodeId);
      if (permissions.can("forum.viewDeleted", { nodeId })) deleted.push(nodeId);
    }
    return prepared(ctx, "tags.hub", () =>
      ctx.sqlite.prepare<
        ThreadRow,
        [number, number, number, string, string, string, string, number, number]
      >(hubSql()),
    ).all(
      tagId,
      cursor?.[0] ?? Number.MAX_SAFE_INTEGER,
      cursor?.[1] ?? Number.MAX_SAFE_INTEGER,
      JSON.stringify(open),
      JSON.stringify(own),
      JSON.stringify(moderated),
      JSON.stringify(deleted),
      actorUserId(actor) ?? -1,
      limit,
    );
  },
);
