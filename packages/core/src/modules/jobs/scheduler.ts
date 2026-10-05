import { Cron } from "croner";
import type { Ctx } from "../../context";
import { prepared } from "../../context";
import { writeTx } from "../../db/tx";
import { purgeExpiredCredentials } from "../auth";
import { enqueueJob, flushDownloadCounts, flushViewCounts } from "./queue";
import { registerJobHandlers } from "./rebuild";

export const SCHEDULES = {
  views: "*/5 * * * * *",
  hourly: "0 0 * * * *",
  daily: "0 0 3 * * *",
} as const;
const DAY_MS = 24 * 60 * 60_000;

export const purgeSql = {
  reads:
    "SELECT r.id, t.last_post_at FROM thread_reads r JOIN threads t ON t.id = r.thread_id " +
    "WHERE r.id > ?1 ORDER BY r.id LIMIT 1000",
  done: "SELECT id FROM jobs WHERE status = 'done' AND run_at < ?1 ORDER BY run_at, id LIMIT 1000",
};

export function runViewsTask(ctx: Ctx): number {
  const views = flushViewCounts(ctx);
  flushDownloadCounts(ctx);
  return views;
}

export function runHourlyTasks(ctx: Ctx): void {
  purgeExpiredCredentials(ctx);
  const cutoff = ctx.now() - 30 * DAY_MS;
  const readBatch = prepared(ctx, "jobs.expiredReads", () =>
    ctx.sqlite.prepare<{ id: number; last_post_at: number }, [number]>(purgeSql.reads),
  );
  const deleteReads = prepared(ctx, "jobs.deleteReads", () =>
    ctx.sqlite.prepare("DELETE FROM thread_reads WHERE id IN (SELECT value FROM json_each(?1))"),
  );
  let after = 0;
  while (true) {
    const batch = writeTx(ctx, () => {
      const rows = readBatch.all(after);
      const old = rows.filter((row) => row.last_post_at < cutoff);
      if (old.length > 0) deleteReads.run(JSON.stringify(old.map((row) => row.id)));
      return rows;
    });
    if (batch.length < 1000) break;
    after = batch.at(-1)!.id;
  }
  const doneCutoff = ctx.now() - 7 * DAY_MS;
  const doneBatch = prepared(ctx, "jobs.oldDone", () =>
    ctx.sqlite.prepare<{ id: number }, [number]>(purgeSql.done),
  );
  const deleteDone = prepared(ctx, "jobs.deleteDone", () =>
    ctx.sqlite.prepare("DELETE FROM jobs WHERE id IN (SELECT value FROM json_each(?1))"),
  );
  while (true) {
    const size = writeTx(ctx, () => {
      const rows = doneBatch.all(doneCutoff);
      if (rows.length > 0) deleteDone.run(JSON.stringify(rows.map((row) => row.id)));
      return rows.length;
    });
    if (size < 1000) break;
  }
}

export function runDailyTasks(ctx: Ctx): void {
  enqueueJob(ctx, "storage.cleanup", {}, { uniqueKey: "storage.cleanup" });
  enqueueJob(
    ctx,
    "rebuild-counters",
    { stage: "threads", after: 0 },
    { uniqueKey: "rebuild-counters" },
  );
  ctx.sqlite.exec("PRAGMA optimize");
}

export function startScheduler(ctx: Ctx): () => void {
  registerJobHandlers(ctx);
  const onError = (error: unknown, job: Cron) => console.error(`[cron:${job.name}]`, error);
  const jobs = [
    new Cron(SCHEDULES.views, { name: "jobs.views", protect: true, catch: onError }, () => {
      runViewsTask(ctx);
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
