import type { Ctx } from "../../context";
import { writeTx } from "../../db/tx";
import { POLL_PURGE_BATCH } from "../../limits";
import { enqueueJob, registerJobHandler } from "../jobs";
import { purgePollBatch, purgePolls } from "../purge/purge";
import { isRetiring, pollById } from "./store";

/**
 * Removing a poll that has more voters than one transaction should take (`POLL_PURGE_BATCH`) is
 * background work: the request that deletes it hides it (`retirePoll`) and enqueues this job in the
 * same transaction, and the job removes one batch of voters per write transaction until what is
 * left fits in one, which goes with the poll. The queue holds WAL checkpoints while a handler runs,
 * and the unique key makes a second delete (or a hard delete of the thread) of the same poll add
 * nothing: it is one job at a time, and every step re-reads the poll, so a lease that ran out and a
 * run that starts again do no work twice.
 */
export const POLL_PURGE_JOB = "polls.purge";

/** Call inside the write transaction that retires the poll. */
export function enqueuePollPurge(ctx: Ctx, pollId: number): void {
  enqueueJob(ctx, POLL_PURGE_JOB, { pollId }, { uniqueKey: `${POLL_PURGE_JOB}.${pollId}` });
}

/** One batch, or the last of the poll; whether more is left to do. */
function purgeStep(ctx: Ctx, pollId: number): boolean {
  return writeTx(ctx, () => {
    const poll = pollById(ctx, pollId);
    // Gone already, or never retired: nothing to remove for this job.
    if (!poll || !isRetiring(poll)) return false;
    if (poll.ballot_count > POLL_PURGE_BATCH) {
      purgePollBatch(ctx, pollId);
      return true;
    }
    purgePolls(ctx, [pollId]);
    return false;
  });
}

export function registerPollJobs(ctx: Ctx): void {
  registerJobHandler(ctx, POLL_PURGE_JOB, async (_ctx, payload) => {
    const pollId = (payload as { pollId?: unknown })?.pollId;
    if (!Number.isSafeInteger(pollId) || Number(pollId) < 1)
      throw new TypeError("Invalid poll removal job.");
    // Between batches the loop lets other work (requests, other jobs) take the writer.
    while (purgeStep(ctx, Number(pollId))) await new Promise((resolve) => setImmediate(resolve));
  });
}
