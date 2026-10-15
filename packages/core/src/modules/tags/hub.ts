import { type Actor, actorUserId } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { markPublic } from "../../operation";
import { permissionsOf, viewableNodeIds } from "../../permissions";
import { type ThreadRow, threadColumns } from "../forums";
import { readGates } from "../forums/read-gates";

/**
 * The threads of one tag in activity order, as a thread list shows them. The index
 * `thread_tags_hub` gives the order (its `sort_at` follows the thread's, kept by a trigger), the
 * thread row is one primary-key seek per row, and the viewer's reach is five lists of forums:
 * - `?4` forums whose other-member threads the viewer may open,
 * - `?5` forums where only their own threads are open to them,
 * - `?6` forums where they may see moderated threads, `?7` where they may see deleted ones,
 * - `?10` forums where they may read other members' text: a tag the opening post's hashtags
 *   put on a thread is that text, so it is not theirs to see anywhere else.
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
  "AND (tt.from_post = 0 OR t.user_id = ?8 OR t.node_id IN (SELECT value FROM json_each(?10))) " +
  "ORDER BY tt.sort_at DESC, tt.thread_id DESC LIMIT ?9";

/** What a viewer reaches, worked out once: the forum lists and the viewer, ready for `hubSql`. */
export interface HubReach {
  open: string;
  own: string;
  moderated: string;
  deleted: string;
  readable: string;
  viewer: number;
}

/**
 * The reach of a viewer. With `indexable`, only what a search engine could index: visible
 * threads in forums whose threads and text are both open to the viewer (use it with the guest).
 */
export const hubReach = markPublic(
  "Applies the viewer's own reach: viewable forums, read gates, hidden states.",
  function hubReach(ctx: Ctx, actor: Actor, options: { indexable?: boolean } = {}): HubReach {
    const permissions = permissionsOf(ctx, actor);
    const gates = readGates(ctx, actor);
    const open: number[] = [];
    const own: number[] = [];
    const moderated: number[] = [];
    const deleted: number[] = [];
    const readable: number[] = [];
    for (const nodeId of viewableNodeIds(ctx, actor)) {
      const reads = gates.readsOthers(nodeId);
      if (options.indexable) {
        if (gates.opensOthers(nodeId) && reads) open.push(nodeId);
        continue;
      }
      (gates.opensOthers(nodeId) ? open : own).push(nodeId);
      if (reads) readable.push(nodeId);
      if (permissions.can("forum.viewModerated", { nodeId })) moderated.push(nodeId);
      if (permissions.can("forum.viewDeleted", { nodeId })) deleted.push(nodeId);
    }
    return {
      open: JSON.stringify(open),
      own: JSON.stringify(own),
      moderated: JSON.stringify(moderated),
      deleted: JSON.stringify(deleted),
      readable: JSON.stringify(options.indexable ? open : readable),
      viewer: actorUserId(actor) ?? -1,
    };
  },
);

/**
 * Up to `limit` threads carrying the tag within the reach, after `cursor` (`[sort_at, thread id]`
 * of the last row of the page before). Callers check the site is open.
 */
export function hubThreads(
  ctx: Ctx,
  reach: HubReach,
  tagId: number,
  cursor: readonly [number, number] | null,
  limit: number,
): ThreadRow[] {
  return prepared(ctx, "tags.hub", () =>
    ctx.sqlite.prepare<
      ThreadRow,
      [number, number, number, string, string, string, string, number, number, string]
    >(hubSql()),
  ).all(
    tagId,
    cursor?.[0] ?? Number.MAX_SAFE_INTEGER,
    cursor?.[1] ?? Number.MAX_SAFE_INTEGER,
    reach.open,
    reach.own,
    reach.moderated,
    reach.deleted,
    reach.viewer,
    limit,
    reach.readable,
  );
}
