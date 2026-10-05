import { Cron } from "croner";
import type { Ctx } from "../../context";
import { prepared } from "../../context";
import { writeTx } from "../../db/tx";
import { purgeExpiredCredentials } from "../auth";
import { enqueueJob, flushViewCounts } from "./index";
import { registerCounterRebuild } from "./rebuild";

export const SCHEDULES = {
  views: "*/5 * * * * *",
  hourly: "0 0 * * * *",
  daily: "0 0 3 * * *",
} as const;
const DAY_MS = 24 * 60 * 60_000;

export function runHourlyTasks(ctx: Ctx): void {
  purgeExpiredCredentials(ctx);
  const cutoff = ctx.now() - 30 * DAY_MS;
  const removeReads = prepared(ctx, "jobs.expiredReads", () =>
    ctx.sqlite.prepare(
      "DELETE FROM thread_reads WHERE id IN (" +
        "SELECT r.id FROM thread_reads r JOIN threads t ON t.id = r.thread_id " +
        "WHERE t.last_post_at < ?1 LIMIT 1000)",
    ),
  );
  while (writeTx(ctx, () => removeReads.run(cutoff).changes) === 1000) {
    /* next bounded batch */
  }
  const doneCutoff = ctx.now() - 7 * DAY_MS;
  const removeDone = prepared(ctx, "jobs.oldDone", () =>
    ctx.sqlite.prepare(
      "DELETE FROM jobs WHERE id IN (SELECT id FROM jobs WHERE status = 'done' AND updated_at < ?1 LIMIT 1000)",
    ),
  );
  while (writeTx(ctx, () => removeDone.run(doneCutoff).changes) === 1000) {
    /* next bounded batch */
  }
}

export function runDailyTasks(ctx: Ctx): void {
  enqueueJob(
    ctx,
    "rebuild-counters",
    { stage: "threads", after: 0 },
    { uniqueKey: "rebuild-counters" },
  );
  ctx.sqlite.exec("PRAGMA optimize");
}

export function startScheduler(ctx: Ctx): () => void {
  registerCounterRebuild(ctx);
  const onError = (error: unknown, job: Cron) => console.error(`[cron:${job.name}]`, error);
  const jobs = [
    new Cron(SCHEDULES.views, { name: "jobs.views", protect: true, catch: onError }, () => {
      flushViewCounts(ctx);
    }),
    new Cron(SCHEDULES.hourly, { name: "jobs.hourly", protect: true, catch: onError }, () =>
      runHourlyTasks(ctx),
    ),
    new Cron(
      SCHEDULES.daily,
      { name: "jobs.daily", protect: true, catch: onError, timezone: "UTC" },
      () => runDailyTasks(ctx),
    ),
  ];
  return () => {
    for (const job of jobs) job.stop();
  };
}
