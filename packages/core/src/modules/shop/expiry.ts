import type { Ctx } from "../../context";
import { writeTx } from "../../db/tx";
import { publishEvent } from "../../events";
import { revokePurchased } from "../../permissions";
import { registerJobHandler } from "../jobs/queue";
import { shopSql, statement } from "./data";
import { releaseUnheldWear } from "./held";

/** A bounded transaction; the time cap also keeps expensive combination changes in small batches. */
export function expireShopBatch(ctx: Ctx): number {
  return writeTx(ctx, () => {
    const start = performance.now();
    const now = ctx.now();
    const due = statement<{ id: number; user_id: number }>(ctx, shopSql.expiry).all(now, 10);
    let expired = 0;
    for (const row of due) {
      if (
        !statement(
          ctx,
          "UPDATE shop_inventory SET state = 'expired', updated_at = ?1 WHERE id = ?2 AND state = 'active' AND expires_at <= ?1",
        ).run(now, row.id).changes
      )
        continue;
      expired++;
      releaseUnheldWear(ctx, row.user_id);
      const { groupsRemoved } = revokePurchased(ctx, row.id);
      if (groupsRemoved.length)
        publishEvent(ctx, {
          type: "member.groups_changed",
          targetType: "user",
          targetId: row.user_id,
          payload: { added: [], removed: groupsRemoved, source: "shop" },
        });
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
