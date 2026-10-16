import type { Ctx } from "../context";

export type Tx = Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0];

/** A write that waited for the lock, or took to commit, at least this long (ms) is logged. */
const SLOW_WRITE_MS = 100;

/**
 * Runs `fn` in a short write transaction that begins immediately (BEGIN IMMEDIATE), so it takes
 * the write lock up front instead of failing to upgrade a read lock later.
 *
 * `fn` must be synchronous: no `await` inside. Do slow work (password hashing, rendering) first.
 * Prepared statements built on `ctx.db` / `ctx.sqlite` run inside the transaction as well.
 * Throwing rolls back.
 *
 * A write that waited for the lock (`wait`, held by another connection), ran (`hold`) or
 * committed (`commit`, where a checkpoint overlapping a stream of commits shows) for 100 ms or
 * more logs `[db.write-wait] at=<time> wait=<ms> hold=<ms> commit=<ms>`. Faster writes only read
 * the clock.
 */
export function writeTx<T>(ctx: Ctx, fn: (tx: Tx) => T): T {
  const start = performance.now();
  let locked = 0;
  let ran = 0;
  try {
    return ctx.db.transaction(
      (tx) => {
        locked = performance.now();
        const result = fn(tx);
        if (typeof (result as { then?: unknown } | null)?.then === "function") {
          // Throwing here rolls back whatever the callback did before its first await.
          throw new Error(
            "writeTx callbacks must be synchronous; do async work before the transaction.",
          );
        }
        ran = performance.now();
        return result;
      },
      { behavior: "immediate" },
    );
  } finally {
    const end = performance.now();
    // Without `locked` the lock was never taken (the wait ended in a failure); without `ran` the
    // callback threw and the rollback is not timed.
    const wait = (locked || end) - start;
    const commit = ran ? end - ran : 0;
    if (wait >= SLOW_WRITE_MS || commit >= SLOW_WRITE_MS) {
      const hold = ran ? ran - locked : 0;
      console.warn(
        `[db.write-wait] at=${new Date().toISOString()} wait=${Math.round(wait)} hold=${Math.round(hold)} commit=${Math.round(commit)}`,
      );
    }
  }
}
