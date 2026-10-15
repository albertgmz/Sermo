import { type Ctx, prepared } from "../../context";
import { writeTx } from "../../db/tx";
import { registerJobHandler } from "../jobs/queue";
import { ipLogRetentionDays } from "./config";

const DAY_MS = 86_400_000;

/** Rows deleted per transaction: short enough that requests never wait on the write lock. */
export const IP_LOG_PURGE_BATCH = 200;

export const retentionSql = {
  // The oldest rows first, from the created_at index; the delete then goes by primary key.
  purge:
    "DELETE FROM ip_log WHERE id IN (SELECT id FROM ip_log WHERE created_at < ?1 ORDER BY created_at LIMIT ?2)",
};

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Deletes `ip_log` rows older than the retention age, `IP_LOG_PURGE_BATCH` at a time, one short
 * transaction each, yielding between them. Returns how many rows went.
 */
export async function purgeIpLog(ctx: Ctx): Promise<number> {
  const cutoff = ctx.now() - ipLogRetentionDays(ctx) * DAY_MS;
  let deleted = 0;
  while (true) {
    const size = writeTx(
      ctx,
      () =>
        prepared(ctx, "security.purge", () => ctx.sqlite.prepare(retentionSql.purge)).run(
          cutoff,
          IP_LOG_PURGE_BATCH,
        ).changes,
    );
    deleted += size;
    if (size < IP_LOG_PURGE_BATCH) return deleted;
    await yieldToEventLoop();
  }
}

/** The daily job (`runDailyTasks` queues it; the worker holds checkpoints while it runs). */
export function registerSecurityJobs(ctx: Ctx): void {
  registerJobHandler(ctx, "security.retention", async (context) => {
    await purgeIpLog(context);
  });
}
