import type { Ctx } from "../context";

/** Shared with the worker: the number of active holds. */
const holds = new WeakMap<Ctx, Int32Array>();

/**
 * Pauses checkpoints while heavy background work writes (a checkpoint running beside a stream of
 * commits can stall a commit for hundreds of milliseconds). The worker still checkpoints once its
 * last checkpoint is older than its limit, so the WAL stays bounded even when holds never end.
 * Returns the release function; releasing twice releases once.
 */
export function holdCheckpoints(ctx: Ctx): () => void {
  const state = holds.get(ctx);
  if (!state) return () => {};
  Atomics.add(state, 0, 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    Atomics.sub(state, 0, 1);
  };
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
  const state = new Int32Array(new SharedArrayBuffer(4));
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
