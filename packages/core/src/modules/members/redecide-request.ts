import { type Ctx, prepared } from "../../context";
import { enqueueJob } from "../jobs/queue";

/** The job that decides the past months again, one month per run, newest first. */
export const REDECIDE_JOB = "standings.redecide";
/** Waits for a run under way, then starts a fresh one. */
export const REDECIDE_AGAIN = "standings.redecide.again";

/** Whether a run is under way: its key is held from the first month to the last. */
export function redecideUnderWay(ctx: Ctx): boolean {
  return !!prepared(ctx, "members.standingRedecideQueued", () =>
    ctx.sqlite.prepare<{ id: number }, [string]>("SELECT id FROM jobs WHERE unique_key = ?1"),
  ).get(REDECIDE_JOB);
}

/**
 * Called in the transaction that changes what decides a month's winner: the standing settings, a
 * ban or its lifting, an erasure. A run under way has passed some months with the old facts, so a
 * fresh run from the newest month is queued for when it ends; with none under way, one starts.
 * The current month's table is refreshed too, without waiting for the next tenth minute.
 *
 * A ban or an erasure can only change the months its member won, so it passes `onlyIfWinner`:
 * nothing is queued unless that member is the winner of some month, or a run is under way (it may
 * be about to give them a month it has not written yet).
 */
export function requestStandingsRedecide(ctx: Ctx, onlyIfWinner?: number): void {
  if (
    onlyIfWinner !== undefined &&
    !redecideUnderWay(ctx) &&
    !prepared(ctx, "members.standingWon", () =>
      ctx.sqlite.prepare<{ 1: number }, [number]>(
        "SELECT 1 FROM month_winners WHERE user_id = ?1 LIMIT 1",
      ),
    ).get(onlyIfWinner)
  )
    return;
  if (redecideUnderWay(ctx)) enqueueJob(ctx, REDECIDE_AGAIN, {}, { uniqueKey: REDECIDE_AGAIN });
  else enqueueJob(ctx, REDECIDE_JOB, { month: 0 }, { uniqueKey: REDECIDE_JOB });
  enqueueJob(ctx, "standings.refresh", {}, { uniqueKey: "standings.refresh" });
}
