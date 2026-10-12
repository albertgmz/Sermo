import type { Ctx } from "../../context";
import { writeTx } from "../../db/tx";
import { publishEvent } from "../../events";
import { revokePurchased } from "../../permissions";
import { registerJobHandler } from "../jobs/queue";
import { shopSql, statement } from "./data";
import { releaseUnheldWear } from "./held";

/**
 * Marks one lapsed row expired and takes back what it granted, as the job does. Inside the
 * caller's write transaction; false when the row is not active and lapsed (another process got
 * there first).
 */
function expireRow(ctx: Ctx, row: { id: number; user_id: number }, now: number): boolean {
  if (
    !statement(
      ctx,
      "UPDATE shop_inventory SET state = 'expired', updated_at = ?1 WHERE id = ?2 AND state = 'active' AND expires_at <= ?1",
    ).run(now, row.id).changes
  )
    return false;
  releaseUnheldWear(ctx, row.user_id);
  const { groupsRemoved } = revokePurchased(ctx, row.id);
  if (groupsRemoved.length)
    publishEvent(ctx, {
      type: "member.groups_changed",
      targetType: "user",
      targetId: row.user_id,
      payload: { added: [], removed: groupsRemoved, source: "shop" },
    });
  return true;
}

/**
 * A purchase treats a row whose time has lapsed as expired even when the job has not marked it
 * yet (it runs up to a minute late), so the item can be bought again at once.
 */
export function expireLapsedRow(ctx: Ctx, userId: number, itemId: number, now: number): void {
  const lapsed = statement<{ id: number; user_id: number }>(
    ctx,
    "SELECT id, user_id FROM shop_inventory WHERE user_id = ?1 AND item_id = ?2 AND state = 'active' AND expires_at <= ?3",
  ).get(userId, itemId, now);
  if (lapsed) expireRow(ctx, lapsed, now);
}

/** A bounded transaction; the time cap also keeps expensive combination changes in small batches. */
export function expireShopBatch(ctx: Ctx): number {
  return writeTx(ctx, () => {
    const start = performance.now();
    const now = ctx.now();
    const due = statement<{ id: number; user_id: number }>(ctx, shopSql.expiry).all(now, 10);
    let expired = 0;
    for (const row of due) {
      if (!expireRow(ctx, row, now)) continue;
      expired++;
      if (performance.now() - start >= 3) break;
    }
    return expired;
  });
}

export function registerShopJobs(ctx: Ctx): void {
  registerJobHandler(ctx, "shop.expire", async (context) => {
    while (expireShopBatch(context) > 0)
      await new Promise<void>((resolve) => setImmediate(resolve));
  });
}
