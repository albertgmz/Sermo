import { type Ctx, prepared } from "../../context";
import { holdCheckpoints, paceWal } from "../../db/checkpointer";
import { writeTx } from "../../db/tx";
import { currentVersions } from "../../permissions";
import { type ClaimedJob, completeRunningJob, enqueueJob, registerJobHandler } from "../jobs/queue";
import { readSiteSettings } from "../settings";
import { REDECIDE_AGAIN, REDECIDE_JOB, redecideUnderWay } from "./redecide-request";
import {
  computeMonth,
  excluderFor,
  type MonthStats,
  monthKey,
  monthOf,
  pointsTenths,
  previousOf,
  splitMonth,
  standingSql,
  storeMonth,
} from "./standings";

/** Members whose standing is checked, best placed first, per round of the choice of a winner. */
const CANDIDATES = 50;

export const redecideSql = {
  firstWinner: "SELECT min(month) AS month FROM month_winners",
  // Neither banned nor erased now: the same test as `standingSql.top`, for a batch of members.
  eligible:
    "SELECT id FROM users WHERE id IN (SELECT value FROM json_each(?1)) AND erased_at IS NULL AND banned_permanently = 0 AND (banned_until IS NULL OR banned_until <= ?2)",
  setWinner:
    "INSERT INTO month_winners (month, user_id, posts, reactions, referrals, points_tenths, decided_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) " +
    "ON CONFLICT (month) DO UPDATE SET user_id = excluded.user_id, posts = excluded.posts, reactions = excluded.reactions, referrals = excluded.referrals, points_tenths = excluded.points_tenths, decided_at = excluded.decided_at",
  clearWinner: "DELETE FROM month_winners WHERE month = ?1",
};

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Runs a generator to its end with a turn of the event loop after each step, so the thread that
 * serves requests never waits for a month. With `writes`, each step waits for the WAL to restart
 * when it has grown past its limit and keeps checkpoints off only while it runs.
 */
async function drive<T>(ctx: Ctx, run: Generator<void, T, void>, writes = false): Promise<T> {
  while (true) {
    if (writes) await paceWal(ctx);
    const release = writes ? holdCheckpoints(ctx) : () => {};
    let step: IteratorResult<void, T>;
    try {
      step = run.next();
    } finally {
      release();
    }
    if (step.done) return step.value;
    await nextTurn();
  }
}

/** The oldest month that has anything to decide from: its first post, or its first stored winner. */
function firstMonth(ctx: Ctx): number | null {
  const post = prepared(ctx, "members.standingProbe.posts", () =>
    ctx.sqlite.prepare<{ id: number; created_at: number }, [number]>(
      standingSql.rowAtOrAfter("posts"),
    ),
  ).get(1);
  const winner = prepared(ctx, "members.standingFirstWinner", () =>
    ctx.sqlite.prepare<{ month: number | null }, []>(redecideSql.firstWinner),
  ).get()?.month;
  const posted = post ? monthOf(post.created_at) : null;
  const keys = [posted ? monthKey(posted.year, posted.month) : null, winner ?? null].filter(
    (key) => key !== null,
  );
  return keys.length > 0 ? Math.min(...keys) : null;
}

/**
 * The best placed member of a month's stats who is not left out by the site's rules and is
 * neither banned nor erased now: the stats are ranked and checked a batch at a time, so a month
 * of thousands costs one or two rounds.
 */
function* chooseWinner(
  ctx: Ctx,
  stats: Map<number, MonthStats>,
): Generator<void, { userId: number; entry: MonthStats; tenths: number } | null, void> {
  const settings = readSiteSettings(ctx);
  const ranked = [...stats]
    .map(([userId, entry]) => ({ userId, entry, tenths: pointsTenths(settings, entry) }))
    .filter((row) => row.tenths > 0)
    .sort((a, b) => b.tenths - a.tenths || b.entry.posts - a.entry.posts || a.userId - b.userId);
  const excluder = excluderFor(ctx, currentVersions(ctx));
  const eligible = prepared(ctx, "members.standingEligible", () =>
    ctx.sqlite.prepare<{ id: number }, [string, number]>(redecideSql.eligible),
  );
  for (let at = 0; at < ranked.length; at += CANDIDATES) {
    const batch = ranked.slice(at, at + CANDIDATES);
    const left = excluder(batch.map((row) => row.userId));
    const open = new Set(
      eligible
        .all(
          JSON.stringify(batch.filter((row) => !left.has(row.userId)).map((row) => row.userId)),
          ctx.now(),
        )
        .map((row) => row.id),
    );
    const winner = batch.find((row) => open.has(row.userId));
    if (winner) return winner;
    yield;
  }
  return null;
}

/**
 * Decides one past month again from its posts, reactions and referrals under today's rules, then
 * queues the month before it. The newest month (the previous one) also gets its standing table
 * rewritten, which the page of that month reads. A month with nothing left to count keeps the
 * winner it has: its posts were removed, not its rules changed. The winner row is rewritten in
 * place, so whoever held the month before simply no longer does; nothing is announced to them.
 * Run by the queue: the chunk commits together with the job's completion and its successor.
 */
export async function redecideChunk(ctx: Ctx, month: number, job: ClaimedJob): Promise<void> {
  const newest = previousOf(monthOf(ctx.now()));
  const newestKey = monthKey(newest.year, newest.month);
  const key = month === 0 ? newestKey : month;
  const floor = firstMonth(ctx);
  const done = () => writeTx(ctx, () => void completeRunningJob(ctx, job));
  if (floor === null || key < floor) return done();
  const stats = await drive(ctx, computeMonth(ctx, splitMonth(key)));
  const winner = stats.size > 0 ? await drive(ctx, chooseWinner(ctx, stats)) : null;
  if (key === newestKey) await drive(ctx, storeMonth(ctx, key, stats), true);
  await paceWal(ctx);
  const release = holdCheckpoints(ctx);
  try {
    writeTx(ctx, () => {
      if (!completeRunningJob(ctx, job)) return;
      const now = ctx.now();
      if (winner)
        prepared(ctx, "members.standingSetWinner", () =>
          ctx.sqlite.prepare<unknown, [number, number, number, number, number, number, number]>(
            redecideSql.setWinner,
          ),
        ).run(
          key,
          winner.userId,
          winner.entry.posts,
          winner.entry.reactions,
          winner.entry.referrals,
          winner.tenths,
          now,
        );
      else if (stats.size > 0)
        prepared(ctx, "members.standingClearWinner", () =>
          ctx.sqlite.prepare<unknown, [number]>(redecideSql.clearWinner),
        ).run(key);
      if (key === newestKey)
        prepared(ctx, "members.standingMark", () =>
          ctx.sqlite.prepare<unknown, [string, string, number]>(standingSql.markDecided),
        ).run("standings.decided", String(key), now);
      const before = previousOf(splitMonth(key));
      const beforeKey = monthKey(before.year, before.month);
      if (beforeKey >= floor)
        enqueueJob(ctx, REDECIDE_JOB, { month: beforeKey }, { uniqueKey: REDECIDE_JOB });
    });
  } finally {
    release();
  }
}

export function registerRedecideJobs(ctx: Ctx): void {
  registerJobHandler(
    ctx,
    REDECIDE_JOB,
    async (context, payload, job) => {
      await redecideChunk(context, (payload as { month: number }).month, job);
    },
    { holdCheckpoints: false },
  );
  // Waits for the run under way, looking again every half minute, then starts a fresh one.
  registerJobHandler(ctx, REDECIDE_AGAIN, (context, _payload, job) => {
    writeTx(context, () => {
      if (!completeRunningJob(context, job)) return;
      if (redecideUnderWay(context))
        enqueueJob(
          context,
          REDECIDE_AGAIN,
          {},
          { uniqueKey: REDECIDE_AGAIN, runAt: context.now() + 30_000 },
        );
      else enqueueJob(context, REDECIDE_JOB, { month: 0 }, { uniqueKey: REDECIDE_JOB });
    });
  });
}
