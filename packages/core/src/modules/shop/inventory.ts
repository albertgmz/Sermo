import * as z from "zod";
import { requireAuthenticated } from "../../actor";
import * as contracts from "../../contracts/shop";
import { writeTx } from "../../db/tx";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { publishEvent } from "../../events";
import { implement } from "../../operation";
import { decodeCursor, encodeCursor } from "../../pagination";
import { can, grantPurchased, requirePermission, revokePurchased } from "../../permissions";
import { moveCredits } from "../../shared/credits";
import {
  category,
  type InventoryRow,
  inventoryValue,
  item,
  itemValue,
  loadItems,
  type PurchaseRow,
  purchasesSql,
  purchaseValues,
  shopSql,
  statement,
} from "./data";

export const buy = implement(contracts.shopBuy, (ctx, actor, input) =>
  writeTx(ctx, () => {
    requirePermission(ctx, actor, "shop.buy");
    const buyer = requireAuthenticated(actor);
    const recipientId = input.recipientId ?? buyer.userId;
    const gift = recipientId !== buyer.userId;
    if (gift) requirePermission(ctx, actor, "shop.gift");
    const row = item(ctx, input.itemId);
    const value = itemValue(row);
    const unavailable = !row.is_active || !category(ctx, row.category_id).is_active;
    if (unavailable && !can(ctx, actor, "admin.shop")) throw new NotFoundError();
    if (gift) {
      if (!value.isGiftable) throw new ForbiddenError("This gift cannot be sent.");
      if (!statement(ctx, shopSql.recipient).get(recipientId)) throw new NotFoundError();
      if (
        can(ctx, actor, "member.ignorable") &&
        statement(ctx, shopSql.ignored).get(recipientId, buyer.userId)
      )
        throw new ForbiddenError("This gift cannot be sent.");
    }
    if (unavailable) throw new ConflictError("This item is not available.");
    if (!value.isConsumable && input.quantity !== 1)
      throw new ValidationError("This item takes quantity 1.");
    const now = ctx.now();
    const held = value.isConsumable
      ? statement<InventoryRow>(
          ctx,
          "INSERT INTO shop_inventory (user_id, item_id, state, quantity, acquired_at, updated_at) VALUES (?1, ?2, 'unused', ?3, ?4, ?4) ON CONFLICT (user_id, item_id) DO UPDATE SET quantity = shop_inventory.quantity + excluded.quantity, state = 'unused', updated_at = excluded.updated_at RETURNING *",
        ).get(recipientId, value.id, input.quantity, now)!
      : statement<InventoryRow>(
          ctx,
          "INSERT INTO shop_inventory (user_id, item_id, state, quantity, expires_at, acquired_at, updated_at) VALUES (?1, ?2, 'active', 1, ?3, ?4, ?4) ON CONFLICT (user_id, item_id) DO UPDATE SET state = 'active', quantity = 1, expires_at = excluded.expires_at, acquired_at = excluded.acquired_at, updated_at = excluded.updated_at WHERE shop_inventory.state = 'expired' RETURNING *",
        ).get(
          recipientId,
          value.id,
          value.durationSeconds === null ? null : now + value.durationSeconds * 1000,
          now,
        );
    if (!held) throw new ConflictError("This item is already owned.");
    if (value.stock !== null) {
      const changed = statement(
        ctx,
        "UPDATE shop_items SET stock = stock - ?1 WHERE id = ?2 AND stock >= ?1",
      ).run(input.quantity, value.id).changes;
      if (!changed) throw new ConflictError("This item is sold out.");
      value.stock -= input.quantity;
    }
    const price = value.price * input.quantity;
    // The purchase id must exist before the charge so the ledger can reference it.
    const purchase = statement<PurchaseRow>(
      ctx,
      "INSERT INTO shop_purchases (item_id, buyer_id, recipient_id, quantity, price, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING *",
    ).get(value.id, buyer.userId, recipientId, input.quantity, price, now)!;
    const balance =
      price === 0
        ? statement<{ credits: number }>(ctx, shopSql.recipient).get(buyer.userId)!.credits
        : moveCredits(ctx, [
            {
              userId: buyer.userId,
              amount: -price,
              type: "purchase",
              actorId: buyer.userId,
              requireFunds: true,
              source: { type: "shop_purchase", id: purchase.id },
            },
          ])[0]!.balance;
    statement(
      ctx,
      "UPDATE users SET shop_purchase_count = shop_purchase_count + ?1 WHERE id = ?2",
    ).run(input.quantity, buyer.userId);
    if (
      (!value.isConsumable || held.quantity === input.quantity) &&
      (value.effect.type === "permission" || value.effect.type === "group")
    ) {
      const { groupAdded } = grantPurchased(ctx, recipientId, held.id, value.effect);
      if (groupAdded && value.effect.type === "group")
        publishEvent(ctx, {
          type: "member.groups_changed",
          targetType: "user",
          targetId: recipientId,
          payload: { added: [value.effect.groupId], removed: [], source: "shop" },
        });
    }
    publishEvent(ctx, {
      type: "shop.purchased",
      targetType: "shop_purchase",
      targetId: purchase.id,
      payload: {
        itemId: value.id,
        buyerId: buyer.userId,
        recipientId,
        quantity: input.quantity,
        price,
        inventoryId: held.id,
      },
    });
    return {
      purchase: purchaseValues(ctx, [purchase])[0]!,
      balance,
      inventory: gift ? null : inventoryValue(held, value),
    };
  }),
);

export const inventory = implement(contracts.shopInventory, (ctx, actor, input) => {
  const member = requireAuthenticated(actor);
  const userId = input.userId ?? member.userId;
  if (userId !== member.userId) {
    requirePermission(ctx, actor, "admin.shop");
    if (!statement(ctx, shopSql.recipient).get(userId)) throw new NotFoundError();
  }
  const cursor = input.cursor
    ? decodeCursor(
        input.cursor,
        z.tuple([z.number().int().nonnegative(), z.number().int().positive()]),
      )
    : [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
  const rows = statement<InventoryRow>(ctx, shopSql.inventory).all(
    userId,
    input.state,
    cursor[0]!,
    cursor[1]!,
    input.limit + 1,
  );
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  const items = loadItems(
    ctx,
    page.map((row) => row.item_id),
  );
  return {
    items: page.map((row) => inventoryValue(row, items.get(row.item_id)!)),
    nextCursor: rows.length > input.limit && last ? encodeCursor([last.updated_at, last.id]) : null,
  };
});

export const use = implement(contracts.shopUse, (ctx, actor, input) =>
  writeTx(ctx, () => {
    requirePermission(ctx, actor, "shop.buy");
    const member = requireAuthenticated(actor);
    const row = statement<InventoryRow>(ctx, shopSql.ownInventory).get(
      input.inventoryId,
      member.userId,
    );
    if (!row) throw new NotFoundError();
    const value = itemValue(item(ctx, row.item_id));
    const effect = value.effect;
    if (effect.type === "group" || (effect.type === "permission" && !value.isConsumable))
      throw new ConflictError("This item applies while held and cannot be used.");
    const needsThread =
      effect.type === "threadCover" || effect.type === "highlight" || effect.type === "bump";
    if (needsThread !== (input.threadId !== undefined))
      throw new ValidationError(
        needsThread ? "A thread is required." : "This item does not take a thread.",
      );
    if ((effect.type === "usernameChange") !== (input.value !== undefined))
      throw new ValidationError(
        effect.type === "usernameChange"
          ? "A new username is required."
          : "This item does not take a value.",
      );
    if (needsThread) {
      const thread = statement<{ user_id: number; node_id: number; state: string }>(
        ctx,
        shopSql.thread,
      ).get(input.threadId!);
      if (!thread || thread.user_id !== member.userId || thread.state !== "visible")
        throw new NotFoundError();
      requirePermission(ctx, actor, "node.view", { nodeId: thread.node_id }, { notFound: true });
    }
    let used = row;
    if (value.isConsumable) {
      const changed = statement<InventoryRow>(
        ctx,
        "UPDATE shop_inventory SET quantity = quantity - 1, state = CASE WHEN quantity = 1 THEN 'used' ELSE 'unused' END, updated_at = ?1 WHERE id = ?2 AND user_id = ?3 AND state = 'unused' AND quantity > 0 RETURNING *",
      ).get(ctx.now(), row.id, member.userId);
      if (!changed) throw new ConflictError("No units are left.");
      used = changed;
      if (used.quantity === 0) revokePurchased(ctx, row.id);
    } else if (row.state !== "active") throw new ConflictError("This item is not active.");
    publishEvent(ctx, {
      type: "shop.item_used",
      targetType: "shop_inventory",
      targetId: row.id,
      payload: {
        userId: member.userId,
        itemId: value.id,
        effect,
        ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
        ...(input.value === undefined ? {} : { value: input.value }),
        quantityLeft: used.quantity,
      },
    });
    return inventoryValue(used, value);
  }),
);

export const purchases = implement(contracts.shopPurchases, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.shop");
  const before = input.cursor
    ? decodeCursor(input.cursor, z.tuple([z.number().int().positive()]))[0]
    : Number.MAX_SAFE_INTEGER;
  const params = [
    before,
    ...(input.buyerId === undefined ? [] : [input.buyerId]),
    ...(input.itemId === undefined ? [] : [input.itemId]),
    input.limit + 1,
  ];
  const rows = statement<PurchaseRow>(
    ctx,
    purchasesSql(input.buyerId !== undefined, input.itemId !== undefined),
  ).all(...params);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return {
    items: purchaseValues(ctx, page),
    nextCursor: rows.length > input.limit && last ? encodeCursor([last.id]) : null,
  };
});
