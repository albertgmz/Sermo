import { statSync } from "node:fs";
import type { Ctx } from "../context";
import { CAUGHT_UP, COPIED, HOLDS, PACE_WAITING, RUNNING, STATE_SLOTS } from "./checkpoint-state";

/** Shared with the worker: holds, waiting jobs and complete checkpoints (`checkpoint-state.ts`). */
const holds = new WeakMap<Ctx, Int32Array>();

/** How long `paceWal` waits, without the checkpoint making progress, before the job carries on. */
const PACE_MAX_WAIT_MS = 10_000;

/** The WAL size at which `paceWal` last gave up: it waits again only after the WAL doubles. */
const gaveUpAt = new WeakMap<Ctx, number>();

/**
 * Pauses checkpoints while heavy background work writes (a checkpoint running beside a stream of
 * commits can stall a commit for hundreds of milliseconds). The worker still checkpoints once its
 * last checkpoint is older than its limit, so the WAL stays bounded even when holds never end.
 * Returns the release function; releasing twice releases once.
 */
export function holdCheckpoints(ctx: Ctx): () => void {
  const state = holds.get(ctx);
  if (!state) return () => {};
  Atomics.add(state, HOLDS, 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    Atomics.sub(state, HOLDS, 1);
  };
}

/**
 * Lets the WAL restart in the middle of a long stream of background commits. A checkpoint only
 * restarts the WAL when no write lands between its start and the next write finding every frame
 * copied; a job that commits back to back never leaves that gap, so the WAL grows for as long as
 * the job runs (about 5 KB per notification delivered: 1.7 GB for 330,000 rows in the
 * measurements). Await this between a job's transactions: once the WAL file is past
 * `journal_size_limit` (which cuts it back when it restarts, so a larger file is live frames),
 * the job stops writing until the worker has completed a checkpoint that began after it stopped,
 * and its next write restarts the WAL. Costs a pragma read and a `stat` per call while the WAL is
 * small. Does nothing without a checkpointer (SQLite then checkpoints inside commits).
 *
 * The wait goes on while a checkpoint is running or the frames it copied keep changing, so a slow
 * disk is waited for. It ends after `maxWaitMs` (ten seconds) without progress, as when a reader
 * keeps an old snapshot; the next wait then comes only once the WAL has doubled, so one stuck
 * reader cannot stall the job batch by batch. Stopping the checkpointer ends the wait too.
 */
export async function paceWal(ctx: Ctx, maxWaitMs = PACE_MAX_WAIT_MS): Promise<void> {
  const state = holds.get(ctx);
  if (!state) return;
  const limit = (
    ctx.sqlite.query("PRAGMA journal_size_limit").get() as { journal_size_limit: number }
  ).journal_size_limit;
  const size = walBytes(ctx);
  if (limit <= 0 || size <= limit) {
    gaveUpAt.delete(ctx);
    return;
  }
  if (size <= 2 * (gaveUpAt.get(ctx) ?? 0)) return;
  // The checkpoint in progress may have started before this job stopped writing: wait for the
  // second one.
  const target = Atomics.load(state, CAUGHT_UP) + 2;
  let copied = Atomics.load(state, COPIED);
  let running = 0;
  let deadline = performance.now() + maxWaitMs;
  Atomics.add(state, PACE_WAITING, 1);
  try {
    while (Atomics.load(state, CAUGHT_UP) - target < 0) {
      if (holds.get(ctx) !== state) return;
      // The same checkpoint seen running twice is a long one; short ones are mostly missed.
      const inFlight = Atomics.load(state, RUNNING);
      const copiedNow = Atomics.load(state, COPIED);
      if ((inFlight !== 0 && inFlight === running) || copiedNow !== copied)
        deadline = performance.now() + maxWaitMs;
      running = inFlight;
      copied = copiedNow;
      if (performance.now() >= deadline) {
        gaveUpAt.set(ctx, size);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    gaveUpAt.delete(ctx);
  } finally {
    Atomics.sub(state, PACE_WAITING, 1);
  }
}

function walBytes(ctx: Ctx): number {
  try {
    return statSync(`${ctx.sqlite.filename}-wal`).size;
  } catch {
    return 0;
  }
}

/**
 * Moves WAL checkpoints off the request path.
 *
 * With SQLite's default auto-checkpoint, the commit that grows the WAL past 1,000 pages copies
 * them into the database file and fsyncs it before returning: on a 2.6 GB database that single
 * request took 0.6–1.7 s. This turns auto-checkpointing off for `ctx` and runs PASSIVE
 * checkpoints on a worker thread with its own connection instead. A passive checkpoint never
 * blocks readers or writers.
 *
 * Start it in the long-running server process. A process that does not start it keeps SQLite's
 * default auto-checkpoint, so the WAL cannot grow without bound by accident.
 * The returned function stops the worker and resolves once its connection is closed.
 * `testMaxHoldMs` shortens the longest holds may delay a checkpoint (30 s), for tests.
 */
export function startCheckpointer(
  ctx: Ctx,
  options: { intervalMs?: number; testMaxHoldMs?: number } = {},
): () => Promise<void> {
  const path = ctx.sqlite.filename;
  if (!path || path === ":memory:") return async () => {};
  ctx.sqlite.run("PRAGMA wal_autocheckpoint = 0");
  const state = new Int32Array(new SharedArrayBuffer(STATE_SLOTS * 4));
  holds.set(ctx, state);
  const worker = new Worker(new URL("./checkpoint-worker.ts", import.meta.url));
  worker.postMessage({
    type: "start",
    path,
    intervalMs: options.intervalMs ?? 1000,
    maxHoldMs: options.testMaxHoldMs ?? 30_000,
    state,
  });
  return () =>
    new Promise<void>((resolve) => {
      worker.onmessage = () => {
        worker.terminate();
        holds.delete(ctx);
        ctx.sqlite.run("PRAGMA wal_autocheckpoint = 1000");
        resolve();
      };
      worker.postMessage({ type: "stop" });
    });
}
