import type { Ctx } from "../context";

export type Tx = Parameters<Parameters<Ctx["db"]["transaction"]>[0]>[0];

/**
 * Runs `fn` in a short write transaction that begins immediately (BEGIN IMMEDIATE), so it takes
 * the write lock up front instead of failing to upgrade a read lock later.
 *
 * `fn` must be synchronous: no `await` inside. Do slow work (password hashing, rendering) first.
 * Prepared statements built on `ctx.db` / `ctx.sqlite` run inside the transaction as well.
 * Throwing rolls back.
 */
export function writeTx<T>(ctx: Ctx, fn: (tx: Tx) => T): T {
  return ctx.db.transaction(
    (tx) => {
      const result = fn(tx);
      if (typeof (result as { then?: unknown } | null)?.then === "function") {
        // Throwing here rolls back whatever the callback did before its first await.
        throw new Error(
          "writeTx callbacks must be synchronous; do async work before the transaction.",
        );
      }
      return result;
    },
    { behavior: "immediate" },
  );
}
