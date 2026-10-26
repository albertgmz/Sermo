import * as z from "zod";
import { type Ctx, prepared } from "../../context";
import { writeTx } from "../../db/tx";
import { type ClaimedJob, completeRunningJob, enqueueJob, registerJobHandler } from "../jobs/queue";

export const CREDIT_RECALCULATE_CHUNK_SIZE = 100;
const progressSchema = z.object({ after: z.number().int().nonnegative() });

export const rebuildSql = {
  page:
    "SELECT u.id, u.credits, (SELECT COALESCE(SUM(amount), 0) FROM credit_transactions WHERE user_id = u.id) AS balance " +
    "FROM users u WHERE u.id > ?1 ORDER BY u.id LIMIT ?2",
  update: "UPDATE users SET credits = ?1 WHERE id = ?2 AND credits != ?1",
};

/** Repairs counters from the ledger; completion and continuation commit with the same chunk. */
export function recalculateCreditsChunk(ctx: Ctx, payload: unknown, job: ClaimedJob): number {
  const { after } = progressSchema.parse(payload);
  return writeTx(ctx, () => {
    // A completed or superseded claim must not repair counters or queue another chunk.
    if (!completeRunningJob(ctx, job)) return 0;
    const rows = prepared(ctx, "credits.rebuildPage", () =>
      ctx.sqlite.prepare<{ id: number; credits: number; balance: number }, [number, number]>(
        rebuildSql.page,
      ),
    ).all(after, CREDIT_RECALCULATE_CHUNK_SIZE);
    const update = prepared(ctx, "credits.rebuildUpdate", () =>
      ctx.sqlite.prepare(rebuildSql.update),
    );
    let changed = 0;
    for (const row of rows) {
      if (row.credits !== row.balance) {
        update.run(row.balance, row.id);
        changed++;
      }
    }
    if (rows.length === CREDIT_RECALCULATE_CHUNK_SIZE)
      enqueueJob(
        ctx,
        "credits.recalculate",
        { after: rows.at(-1)!.id },
        { uniqueKey: "credits.recalculate" },
      );
    return changed;
  });
}

export function registerRecalculateJob(ctx: Ctx): void {
  registerJobHandler(ctx, "credits.recalculate", (context, payload, job) => {
    recalculateCreditsChunk(context, payload, job);
  });
}
