import type { Actor } from "../../actor";
import type { Ctx } from "../../context";
import { ForbiddenError, NotFoundError } from "../../errors";
import { markPublic } from "../../operation";
import { readGates, requireThread, type ThreadRow } from "../forums";
import { type PollRow, pollById } from "./store";

const CLOSED = "The posts of this forum are not open to you.";

/**
 * The poll and its thread for someone who may read the thread: not found when the poll is gone
 * or the viewer cannot open the thread, forbidden when its posts are closed to them (a titles-only
 * reader sees neither the question nor the results). Reading is not voting: callers add the rest.
 */
export const requirePoll = markPublic(
  "Opens the poll through the thread's own visibility and read gates; callers add the action's permission.",
  function requirePoll(
    ctx: Ctx,
    actor: Actor,
    pollId: number,
  ): { poll: PollRow; thread: ThreadRow } {
    const poll = pollById(ctx, pollId);
    if (!poll) throw new NotFoundError();
    const { row } = requireThread(ctx, actor, poll.thread_id);
    if (!readGates(ctx, actor).reads(row.node_id, row.user_id)) throw new ForbiddenError(CLOSED);
    return { poll, thread: row };
  },
);

/** Whether the viewer may see the pictures of a poll: the same rule as the poll itself. */
export const pollPicturesReadable = markPublic(
  "Applies the thread's visibility and read gates; the file permission is checked by the caller.",
  function pollPicturesReadable(ctx: Ctx, actor: Actor, pollId: number): boolean {
    try {
      requirePoll(ctx, actor, pollId);
      return true;
    } catch {
      return false;
    }
  },
);
