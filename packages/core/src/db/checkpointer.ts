import type { Ctx } from "../context";

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
 */
export function startCheckpointer(
  ctx: Ctx,
  options: { intervalMs?: number } = {},
): () => Promise<void> {
  const path = ctx.sqlite.filename;
  if (!path || path === ":memory:") return async () => {};
  ctx.sqlite.run("PRAGMA wal_autocheckpoint = 0");
  const worker = new Worker(new URL("./checkpoint-worker.ts", import.meta.url));
  worker.postMessage({ type: "start", path, intervalMs: options.intervalMs ?? 1000 });
  return () =>
    new Promise<void>((resolve) => {
      worker.onmessage = () => {
        worker.terminate();
        ctx.sqlite.run("PRAGMA wal_autocheckpoint = 1000");
        resolve();
      };
      worker.postMessage({ type: "stop" });
    });
}
