import { type Actor, actorUserId } from "../../actor";
import type { Ctx } from "../../context";
import { markPublic } from "../../operation";
import { permissionsOf } from "../../permissions";

/**
 * The two read gates of a forum, resolved once for a viewer: `forum.viewOthers` (threads other
 * members started) and `forum.viewContent` (the posts of a thread; without it only titles show).
 * What a member wrote is always theirs to read, so both answers are true for their own work.
 * Every path that reveals a thread or its posts asks here, with the author of what it reveals.
 */
export interface ReadGates {
  /** The viewer's member id; null for a guest. */
  readonly viewerId: number | null;
  /** The thread `ownerId` started in the forum may be opened or listed. */
  opens(nodeId: number, ownerId: number): boolean;
  /** The posts `ownerId` wrote in the forum may be read. */
  reads(nodeId: number, ownerId: number): boolean;
  /** Threads of other members may be opened in the forum. */
  opensOthers(nodeId: number): boolean;
  /** Posts of other members may be read in the forum. */
  readsOthers(nodeId: number): boolean;
}

export const readGates = markPublic(
  "Resolves forum.viewOthers and forum.viewContent for the viewer; callers reveal nothing before asking.",
  function readGates(ctx: Ctx, actor: Actor): ReadGates {
    const permissions = permissionsOf(ctx, actor);
    const viewerId = actorUserId(actor);
    const others = new Map<number, boolean>();
    const content = new Map<number, boolean>();
    const opensOthers = (nodeId: number) => {
      let allowed = others.get(nodeId);
      if (allowed === undefined) {
        allowed = permissions.can("forum.viewOthers", { nodeId });
        others.set(nodeId, allowed);
      }
      return allowed;
    };
    const readsOthers = (nodeId: number) => {
      let allowed = content.get(nodeId);
      if (allowed === undefined) {
        allowed = permissions.can("forum.viewContent", { nodeId });
        content.set(nodeId, allowed);
      }
      return allowed;
    };
    return {
      viewerId,
      opens: (nodeId, ownerId) => ownerId === viewerId || opensOthers(nodeId),
      reads: (nodeId, ownerId) => ownerId === viewerId || readsOthers(nodeId),
      opensOthers,
      readsOthers,
    };
  },
);
