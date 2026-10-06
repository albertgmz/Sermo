import type { Ctx } from "../../context";
import { prepared } from "../../context";
import { writeTx } from "../../db/tx";
export interface EnqueueOptions {
  runAt?: number;
  uniqueKey?: string;
}
/** The run that claimed a job: its lease identifies it against later claims of the same job. */
export type ClaimedJob = { id: number; lockedUntil: number };
export type JobHandler = (ctx: Ctx, payload: unknown, job: ClaimedJob) => void | Promise<void>;
/** Runs inside the transaction that marks a job permanently failed. */
export type JobFailureHook = (
  ctx: Ctx,
  job: { id: number; payload: unknown; error: string },
) => void;
export const MAX_ATTEMPTS = 5;
export const LEASE_MS = 300_000;
const handlers = new WeakMap<Ctx, Map<string, JobHandler>>();
const failureHooks = new WeakMap<Ctx, Map<string, JobFailureHook>>();
type Job = { id: number; type: string; payload: string; attempts: number; locked_until: number };
type Candidate = { id: number; attempts: number };

export const jobSql = {
  pending:
    "SELECT id FROM jobs WHERE status = 'pending' AND run_at <= ?1 ORDER BY run_at, id LIMIT 1",
  expired:
    "SELECT id, attempts FROM jobs WHERE status = 'running' AND locked_until < ?1 ORDER BY run_at, id LIMIT 1",
};

export function enqueueJob(
  ctx: Ctx,
  type: string,
  payload: unknown,
  options: EnqueueOptions = {},
): number | null {
  const encoded = JSON.stringify(payload);
  if (encoded === undefined) throw new TypeError("Job payload must be JSON serializable.");
  return writeTx(ctx, () => {
    const now = ctx.now();
    return (
      prepared(ctx, "jobs.enqueue", () =>
        ctx.sqlite.prepare<{ id: number }, [string, string, number, string | null, number]>(
          "INSERT INTO jobs (type, payload, run_at, unique_key, created_at, updated_at) " +
            "VALUES (?1, ?2, ?3, ?4, ?5, ?5) ON CONFLICT (unique_key) DO NOTHING RETURNING id",
        ),
      ).get(type, encoded, options.runAt ?? now, options.uniqueKey ?? null, now)?.id ?? null
    );
  });
}

export function registerJobHandler(
  ctx: Ctx,
  type: string,
  handler: JobHandler,
  options: { onFailed?: JobFailureHook } = {},
): void {
  const map = handlers.get(ctx) ?? new Map<string, JobHandler>();
  map.set(type, handler);
  handlers.set(ctx, map);
  if (options.onFailed) {
    const hooks = failureHooks.get(ctx) ?? new Map<string, JobFailureHook>();
    hooks.set(type, options.onFailed);
    failureHooks.set(ctx, hooks);
  }
}

/**
 * Marks this run's job done inside the caller's transaction, so a chunked job's write, its
 * successor and its completion commit together: a crash in between cannot run the chunk twice,
 * and the job's key is free for the successor. Returns false when the run no longer owns the job
 * (it completed already, or its lease expired and another run claimed it), which must then do
 * nothing.
 */
export function completeRunningJob(ctx: Ctx, job: ClaimedJob): boolean {
  return (
    prepared(ctx, "jobs.completeRunning", () =>
      ctx.sqlite.prepare(
        "UPDATE jobs SET status = 'done', unique_key = NULL, locked_until = NULL, run_at = ?1, updated_at = ?1 " +
          "WHERE id = ?2 AND status = 'running' AND locked_until = ?3",
      ),
    ).run(ctx.now(), job.id, job.lockedUntil).changes > 0
  );
}

function notifyFailed(ctx: Ctx, type: string, id: number, payload: string, error: string): void {
  const hook = failureHooks.get(ctx)?.get(type);
  if (!hook) return;
  try {
    // A savepoint: a throwing hook must not undo the failure itself and wedge the queue.
    writeTx(ctx, () => hook(ctx, { id, payload: JSON.parse(payload), error }));
  } catch (cause) {
    console.error("[jobs.onFailed]", cause);
  }
}

function claim(ctx: Ctx): Job | "expired" | null {
  return writeTx(ctx, () => {
    const now = ctx.now();
    const expired = prepared(ctx, "jobs.expired", () =>
      ctx.sqlite.prepare<Candidate, [number]>(jobSql.expired),
    ).get(now);
    if (expired && expired.attempts >= MAX_ATTEMPTS) {
      const error = `Lease expired after ${expired.attempts} attempts.`;
      const failed = prepared(ctx, "jobs.expiredFailed", () =>
        ctx.sqlite.prepare<{ type: string; payload: string }, [string, number, number]>(
          "UPDATE jobs SET status = 'failed', unique_key = NULL, locked_until = NULL, " +
            "last_error = ?1, updated_at = ?2 WHERE id = ?3 AND status = 'running' RETURNING type, payload",
        ),
      ).get(error, now, expired.id);
      if (failed) notifyFailed(ctx, failed.type, expired.id, failed.payload, error);
      return "expired";
    }
    const pending = expired
      ? null
      : prepared(ctx, "jobs.pending", () =>
          ctx.sqlite.prepare<{ id: number }, [number]>(jobSql.pending),
        ).get(now);
    const id = expired?.id ?? pending?.id;
    if (id === undefined) return null;
    return (
      prepared(ctx, "jobs.claim", () =>
        ctx.sqlite.prepare<Job, [number, number, number]>(
          "UPDATE jobs SET status = 'running', attempts = attempts + 1, locked_until = ?1, updated_at = ?2 " +
            "WHERE id = ?3 RETURNING id, type, payload, attempts, locked_until",
        ),
      ).get(now + LEASE_MS, now, id) ?? null
    );
  });
}

export async function runDueJobs(ctx: Ctx, options: { limit?: number } = {}): Promise<number> {
  const limit = options.limit ?? 100;
  if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError("Invalid job limit.");
  let ran = 0;
  while (ran < limit) {
    const job = claim(ctx);
    if (!job) break;
    if (job === "expired") continue;
    ran++;
    const handler = handlers.get(ctx)?.get(job.type);
    let error: string | null = null;
    if (!handler) error = `Unknown job type: ${job.type}`;
    else {
      try {
        await handler(ctx, JSON.parse(job.payload), { id: job.id, lockedUntil: job.locked_until });
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
      }
    }
    writeTx(ctx, () => {
      const now = ctx.now();
      if (error === null) {
        prepared(ctx, "jobs.done", () =>
          ctx.sqlite.prepare(
            "UPDATE jobs SET status = 'done', unique_key = NULL, locked_until = NULL, run_at = ?1, updated_at = ?1 " +
              "WHERE id = ?2 AND status = 'running' AND locked_until = ?3",
          ),
        ).run(now, job.id, job.locked_until);
      } else {
        const failed = !handler || job.attempts >= MAX_ATTEMPTS;
        const backoff = [30_000, 120_000, 600_000, 3_600_000][Math.min(job.attempts - 1, 3)]!;
        const { changes } = prepared(ctx, "jobs.fail", () =>
          ctx.sqlite.prepare(
            "UPDATE jobs SET status = ?1, run_at = ?2, last_error = ?3, " +
              "unique_key = CASE WHEN ?1 = 'failed' THEN NULL ELSE unique_key END, " +
              "locked_until = NULL, updated_at = ?4 " +
              "WHERE id = ?5 AND status = 'running' AND locked_until = ?6",
          ),
        ).run(failed ? "failed" : "pending", now + backoff, error, now, job.id, job.locked_until);
        if (failed && changes) notifyFailed(ctx, job.type, job.id, job.payload, error);
      }
    });
  }
  return ran;
}

export function startJobWorker(ctx: Ctx, options: { pollMs?: number } = {}): () => void {
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void runDueJobs(ctx)
      .catch((error: unknown) => console.error("[jobs.worker]", error))
      .finally(() => {
        busy = false;
      });
  }, options.pollMs ?? 1000);
  return () => clearInterval(timer);
}

export function flushViewCounts(ctx: Ctx): number {
  const batch = [...ctx.views];
  ctx.views.clear();
  if (batch.length === 0) return 0;
  try {
    writeTx(ctx, () => {
      const update = prepared(ctx, "jobs.flushViews", () =>
        ctx.sqlite.prepare("UPDATE threads SET view_count = view_count + ?1 WHERE id = ?2"),
      );
      for (const [id, count] of batch) update.run(count, id);
    });
  } catch (error) {
    for (const [id, count] of batch) ctx.views.set(id, (ctx.views.get(id) ?? 0) + count);
    throw error;
  }
  return batch.length;
}

export function flushDownloadCounts(ctx: Ctx): number {
  const batch = [...ctx.downloads];
  ctx.downloads.clear();
  if (!batch.length) return 0;
  try {
    writeTx(ctx, () => {
      const update = prepared(ctx, "jobs.flushDownloads", () =>
        ctx.sqlite.prepare("UPDATE files SET download_count = download_count + ?1 WHERE id = ?2"),
      );
      for (const [id, count] of batch) update.run(count, id);
    });
  } catch (error) {
    for (const [id, count] of batch) ctx.downloads.set(id, (ctx.downloads.get(id) ?? 0) + count);
    throw error;
  }
  return batch.length;
}

/** Writes buffered member activity (`users.last_activity_at`), never moving it backwards. */
export function flushActivity(ctx: Ctx): number {
  const batch = [...ctx.activity];
  ctx.activity.clear();
  if (!batch.length) return 0;
  try {
    writeTx(ctx, () => {
      const update = prepared(ctx, "jobs.flushActivity", () =>
        ctx.sqlite.prepare(
          "UPDATE users SET last_activity_at = ?1 WHERE id = ?2 AND (last_activity_at IS NULL OR last_activity_at < ?1)",
        ),
      );
      for (const [id, at] of batch) update.run(at, id);
    });
  } catch (error) {
    for (const [id, at] of batch) ctx.activity.set(id, Math.max(ctx.activity.get(id) ?? 0, at));
    throw error;
  }
  return batch.length;
}
