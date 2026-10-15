import { type Actor, actorUserId } from "../../actor";
import { markPublic } from "../../operation";
import type { permissionsOf } from "../../permissions";

/** What a poll's rules need of its thread. */
export interface PollThread {
  id: number;
  node_id: number;
  user_id: number;
  is_locked: number;
  state: string;
}

/** What they need of the poll. */
export interface PollFacts {
  id: number;
  user_id: number;
  kind: "poll" | "quiz";
  anonymous: number;
  allow_custom: number;
  closes_at: number | null;
  closed_at: number | null;
  ballot_count: number;
}

export interface PollRights {
  manage: boolean;
  edit: boolean;
  delete: boolean;
  close: boolean;
  /** The poll is open (not closed by hand, close date not reached). */
  open: boolean;
  /** The permission to vote and a thread that is visible: the poll's own state aside. */
  vote: boolean;
  addAnswer: boolean;
  viewVoters: boolean;
}

type Permissions = ReturnType<typeof permissionsOf>;

export const isClosed = (poll: Pick<PollFacts, "closes_at" | "closed_at">, now: number): boolean =>
  poll.closed_at !== null || (poll.closes_at !== null && poll.closes_at <= now);

/** Whether the thread may take a poll from this member: its author while it is unlocked, or staff. */
export const mayAddPoll = markPublic(
  "Decides with the viewer's own permissions, passed in; callers open the thread first.",
  function mayAddPoll(
    permissions: Permissions,
    actor: Actor,
    thread: Pick<PollThread, "node_id" | "user_id" | "is_locked">,
  ): boolean {
    const nodeId = thread.node_id;
    return (
      permissions.can("poll.manage", { nodeId }) ||
      (!thread.is_locked &&
        thread.user_id === actorUserId(actor) &&
        permissions.can("poll.create", { nodeId }))
    );
  },
);

/**
 * What the viewer may do with a poll. Creating and editing belong to the creator while the thread
 * is unlocked and to staff who manage polls; closing to the creator with `poll.closeOwn` and to
 * `poll.closeAny`; voting needs `poll.vote` and a visible thread. Whether the viewer may read the
 * thread at all is decided before this is asked.
 */
export const pollRights = markPublic(
  "Decides with the viewer's own permissions, passed in; callers open the thread first.",
  function pollRights(
    permissions: Permissions,
    actor: Actor,
    poll: PollFacts,
    thread: PollThread,
    now: number,
  ): PollRights {
    const nodeId = thread.node_id;
    const owns = poll.user_id === actorUserId(actor);
    const manage = permissions.can("poll.manage", { nodeId });
    const open = !isClosed(poll, now);
    const vote = thread.state === "visible" && permissions.can("poll.vote", { nodeId });
    return {
      manage,
      open,
      vote,
      edit: manage || (owns && !thread.is_locked && permissions.can("poll.create", { nodeId })),
      delete: manage || (owns && !thread.is_locked && poll.ballot_count === 0),
      close:
        permissions.can("poll.closeAny", { nodeId }) ||
        (owns && permissions.can("poll.closeOwn", { nodeId, ownerId: poll.user_id })),
      addAnswer:
        vote &&
        open &&
        poll.kind === "poll" &&
        !!poll.allow_custom &&
        permissions.can("poll.addAnswer", { nodeId }),
      viewVoters:
        poll.kind === "poll" && !poll.anonymous && permissions.can("poll.viewVoters", { nodeId }),
    };
  },
);

/**
 * Whether the viewer sees the counts. A closed poll shows them to everyone; before that the
 * poll's own rule decides, and its creator and staff who manage polls always see them.
 */
export function resultsShown(
  poll: { results: string; user_id: number },
  viewerId: number | null,
  manage: boolean,
  voted: boolean,
  closed: boolean,
): boolean {
  if (closed || manage || poll.user_id === viewerId) return true;
  if (poll.results === "always") return true;
  return poll.results === "after_vote" && voted;
}
