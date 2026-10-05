import type { Ctx } from "../../context";
import { prepared } from "../../context";
import { writeTx } from "../../db/tx";
import type { AnyOperation } from "../../operation";

export const operations: AnyOperation[] = [];
export interface EnqueueOptions {
  runAt?: number;
  uniqueKey?: string;
}
export type JobHandler = (ctx: Ctx, payload: unknown) => void | Promise<void>;
export const MAX_ATTEMPTS = 5;
export const LEASE_MS = 300_000;
const handlers = new WeakMap<Ctx, Map<string, JobHandler>>();
type Job = { id: number; type: string; payload: string; attempts: number; locked_until: number };

export const jobSql = {
  pending:
    "SELECT id FROM jobs WHERE status = 'pending' AND run_at <= ?1 ORDER BY run_at, id LIMIT 1",
  expired:
    "SELECT id FROM jobs WHERE status = 'running' AND locked_until < ?1 ORDER BY run_at, id LIMIT 1",
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

export function registerJobHandler(ctx: Ctx, type: string, handler: JobHandler): void {
  const map = handlers.get(ctx) ?? new Map<string, JobHandler>();
  map.set(type, handler);
  handlers.set(ctx, map);
}

function claim(ctx: Ctx): Job | null {
  return writeTx(ctx, () => {
    const now = ctx.now();
    const pending = prepared(ctx, "jobs.pending", () =>
      ctx.sqlite.prepare<{ id: number }, [number]>(jobSql.pending),
    ).get(now);
    const expired = prepared(ctx, "jobs.expired", () =>
      ctx.sqlite.prepare<{ id: number }, [number]>(jobSql.expired),
    ).get(now);
    const id = pending?.id ?? expired?.id;
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
    ran++;
    const handler = handlers.get(ctx)?.get(job.type);
    let error: string | null = null;
    if (!handler) error = `Unknown job type: ${job.type}`;
    else {
      try {
        await handler(ctx, JSON.parse(job.payload));
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause);
      }
    }
    writeTx(ctx, () => {
      const now = ctx.now();
      if (error === null) {
        prepared(ctx, "jobs.done", () =>
          ctx.sqlite.prepare(
            "UPDATE jobs SET status = 'done', unique_key = NULL, locked_until = NULL, updated_at = ?1 " +
              "WHERE id = ?2 AND status = 'running' AND locked_until = ?3",
          ),
        ).run(now, job.id, job.locked_until);
      } else {
        const failed = !handler || job.attempts >= MAX_ATTEMPTS;
        const backoff = Math.min(3_600_000, 1000 * 2 ** (job.attempts - 1));
        prepared(ctx, "jobs.fail", () =>
          ctx.sqlite.prepare(
            "UPDATE jobs SET status = ?1, run_at = ?2, last_error = ?3, " +
              "unique_key = CASE WHEN ?1 = 'failed' THEN NULL ELSE unique_key END, " +
              "locked_until = NULL, updated_at = ?4 " +
              "WHERE id = ?5 AND status = 'running' AND locked_until = ?6",
          ),
        ).run(failed ? "failed" : "pending", now + backoff, error, now, job.id, job.locked_until);
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
  const batch = ctx.views;
  (ctx as { views: Map<number, number> }).views = new Map();
  if (batch.size === 0) return 0;
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
  return batch.size;
}

export { rebuildCountersChunk, registerCounterRebuild } from "./rebuild";
export { runDailyTasks, runHourlyTasks, startScheduler } from "./scheduler";
