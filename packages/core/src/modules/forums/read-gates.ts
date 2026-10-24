import { type Actor, actorUserId } from "../../actor";
import type { Ctx } from "../../context";
import type { AdultRefusal } from "../../errors";
import { markPublic } from "../../operation";
import { type AdultOption, adultRefusalFor, permissionsOf } from "../../permissions";

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
  /** Why the viewer may not see +18 content (resolved when first asked); null when they may. */
  adult(): AdultRefusal | null;
  /**
   * A thread's own +18 mark keeps it from the viewer: it is marked, it is not theirs, and they may
   * not see +18 content. (A forum's mark is decided by node.view.)
   */
  hidesAdult(thread: { is_adult: number; user_id: number }): boolean;
}

export const readGates = markPublic(
  "Resolves forum.viewOthers and forum.viewContent for the viewer; callers reveal nothing before asking.",
  function readGates(ctx: Ctx, actor: Actor, options: AdultOption = {}): ReadGates {
    const permissions = permissionsOf(ctx, actor, options);
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
    let refusal: AdultRefusal | null | undefined;
    const adult = () => {
      if (refusal === undefined) refusal = adultRefusalFor(ctx, actor);
      return refusal;
    };
    return {
      viewerId,
      opens: (nodeId, ownerId) => ownerId === viewerId || opensOthers(nodeId),
      reads: (nodeId, ownerId) => ownerId === viewerId || readsOthers(nodeId),
      opensOthers,
      readsOthers,
      adult,
      hidesAdult: (thread) =>
        thread.is_adult === 1 && thread.user_id !== viewerId && adult() !== null,
    };
  },
);
