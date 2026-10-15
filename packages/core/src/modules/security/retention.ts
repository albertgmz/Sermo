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

export const acceptanceRetentionSql = {
  // In primary-key order, which is also the order of time: the walk stops at the first row newer
  // than the cutoff.
  scan: "SELECT id, accepted_at, ip IS NOT NULL AS has_ip FROM terms_acceptances WHERE id > ?1 ORDER BY id LIMIT ?2",
  clear:
    "UPDATE terms_acceptances SET ip = NULL WHERE ip IS NOT NULL AND id IN (SELECT value FROM json_each(?1))",
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

/**
 * Drops the address from the terms and rules acceptances older than the retention age, as the
 * `ip_log` rows go. The row stays: the version and the date remain the record. Returns how many
 * addresses went.
 */
export async function purgeAcceptanceAddresses(ctx: Ctx): Promise<number> {
  const cutoff = ctx.now() - ipLogRetentionDays(ctx) * DAY_MS;
  let cleared = 0;
  let after = 0;
  while (true) {
    const rows = prepared(ctx, "security.acceptanceScan", () =>
      ctx.sqlite.prepare<{ id: number; accepted_at: number; has_ip: number }, [number, number]>(
        acceptanceRetentionSql.scan,
      ),
    ).all(after, IP_LOG_PURGE_BATCH);
    const old = rows.filter((row) => row.accepted_at < cutoff);
    const ids = old.filter((row) => row.has_ip === 1).map((row) => row.id);
    if (ids.length > 0)
      cleared += writeTx(
        ctx,
        () =>
          prepared(ctx, "security.acceptanceClear", () =>
            ctx.sqlite.prepare(acceptanceRetentionSql.clear),
          ).run(JSON.stringify(ids)).changes,
      );
    if (old.length < rows.length || rows.length < IP_LOG_PURGE_BATCH) return cleared;
    after = rows[rows.length - 1]!.id;
    await yieldToEventLoop();
  }
}

/** The daily job (`runDailyTasks` queues it; the worker holds checkpoints while it runs). */
export function registerSecurityJobs(ctx: Ctx): void {
  registerJobHandler(ctx, "security.retention", async (context) => {
    await purgeIpLog(context);
    await purgeAcceptanceAddresses(context);
  });
}
