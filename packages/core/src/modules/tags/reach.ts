import { type Actor, actorUserId } from "../../actor";
import type { Ctx } from "../../context";
import { markPublic } from "../../operation";
import { permissionsOf, viewableNodeIds } from "../../permissions";
import { readGates } from "../forums/read-gates";

/** What a viewer reaches, worked out once: forum sets and the viewer. */
export interface HubReach {
  /** Forums whose other-member threads the viewer may open. */
  open: ReadonlySet<number>;
  /** Forums where only their own threads are open to them. */
  own: ReadonlySet<number>;
  /** Forums where they may see moderated threads, and where deleted ones. */
  moderated: ReadonlySet<number>;
  deleted: ReadonlySet<number>;
  /** Forums where they may read other members' text: a tag the opening post's hashtags put on a thread is that text. */
  readable: ReadonlySet<number>;
  /** The viewer's member id, -1 for a guest. */
  viewer: number;
  /** The viewer may not see threads marked +18 (other than their own). */
  hidesAdult: boolean;
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
    const open = new Set<number>();
    const own = new Set<number>();
    const moderated = new Set<number>();
    const deleted = new Set<number>();
    const readable = new Set<number>();
    for (const nodeId of viewableNodeIds(ctx, actor)) {
      const reads = gates.readsOthers(nodeId);
      if (options.indexable) {
        if (gates.opensOthers(nodeId) && reads) open.add(nodeId);
        continue;
      }
      (gates.opensOthers(nodeId) ? open : own).add(nodeId);
      if (reads) readable.add(nodeId);
      if (permissions.can("forum.viewModerated", { nodeId })) moderated.add(nodeId);
      if (permissions.can("forum.viewDeleted", { nodeId })) deleted.add(nodeId);
    }
    return {
      open,
      own,
      moderated,
      deleted,
      readable: options.indexable ? open : readable,
      viewer: actorUserId(actor) ?? -1,
      hidesAdult: gates.adult() !== null,
    };
  },
);
