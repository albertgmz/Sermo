import * as z from "zod";
import { type Actor, requireAuthenticated } from "../../actor";
import type { Ctx } from "../../context";
import * as contracts from "../../contracts/shop";
import { writeTx } from "../../db/tx";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { publishEvent } from "../../events";
import { implement } from "../../operation";
import { decodeCursor, encodeCursor } from "../../pagination";
import {
  can,
  currentActor,
  currentVersions,
  explainPermission,
  grantPurchased,
  memberActor,
  PERMISSIONS,
  type PermissionDefinition,
  type PermissionId,
  PRINCIPAL_COLUMNS,
  type PrincipalRow,
  requirePermission,
  revokePurchased,
} from "../../permissions";
import { moveCredits } from "../../shared/credits";
import { requireNotErased } from "../admin/erased";
import { catalogImageById } from "../appearance";
import { addFeature, featureKinds, PAID_FEATURE_MS } from "../forums/features";
import { allAllowFor, allowedBy } from "./audience";
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
import { expireLapsedRow } from "./expiry";
import { releaseUnheldWear } from "./held";

/**
 * Whether the member has this yes/no permission of global scope already through something other
 * than a shop item (a group, a staff role, a grant by hand).
 */
function alreadyHolds(ctx: Ctx, memberId: number, permission: string): boolean {
  if (!Object.hasOwn(PERMISSIONS, permission)) return false;
  const definition: PermissionDefinition = PERMISSIONS[permission as PermissionId];
  // A condition that needs content (own, time-limited, hierarchy, thread ban) has no answer
  // without it. Integer permissions are never "held" (a better value can still be bought) and
  // neither are per-forum ones (they are sold on every forum, which no other grant need cover).
  if (
    definition.type !== "flag" ||
    definition.scope !== "global" ||
    definition.own ||
    definition.timeLimit ||
    definition.hierarchy ||
    definition.threadBan
  )
    return false;
  const row = statement<{ id: number; group_id: number } & PrincipalRow>(
    ctx,
    `SELECT u.id, u.group_id, ${PRINCIPAL_COLUMNS} FROM users u WHERE u.id = ?1`,
  ).get(memberId);
  if (!row) return false;
  const member = memberActor(row.id, row.group_id, row, currentVersions(ctx));
  const explained = explainPermission(ctx, member, permission as PermissionId);
  return (
    explained.granted &&
    explained.layers.some((layer) => layer.kind !== "purchase" && layer.value === "allow")
  );
}

/**
 * The most expensive `group` item the member holds in a category, with its catalog price. A rank
 * is held while its row is active and has not run out: the expiry job marks a lapsed row up to a
 * minute late.
 */
const currentRankSql =
  "SELECT inv.*, it.price AS price FROM shop_inventory inv JOIN shop_items it ON it.id = inv.item_id WHERE inv.user_id = ?1 AND inv.state = 'active' AND (inv.expires_at IS NULL OR inv.expires_at > ?3) AND it.category_id = ?2 AND json_extract(it.effect, '$.type') = 'group' ORDER BY it.price DESC, inv.id LIMIT 1";

/**
 * What a held rank is worth towards an upgrade: a permanent rank, what was paid for it; a timed
 * one, what was paid times the share of its duration still ahead, rounded down.
 */
function rankCredit(row: InventoryRow, now: number): number {
  if (row.expires_at === null) return row.paid_price;
  const total = row.expires_at - row.acquired_at;
  if (total <= 0) return 0;
  return Number((BigInt(row.paid_price) * BigInt(row.expires_at - now)) / BigInt(total));
}

/**
 * A purchase, inside the caller's write transaction. With `upgrade`, a `group` item replaces the
 * member's current rank of its category and costs the difference (see `shop.upgrade`).
 */
function purchase(
  ctx: Ctx,
  actor: Actor,
  input: { itemId: number; quantity: number; recipientId?: number | undefined },
  upgrade = false,
) {
  // The actor was resolved before this transaction: a ban or a lost group applies at once.
  const current = currentActor(ctx, actor);
  requirePermission(ctx, current, "shop.buy");
  const buyer = requireAuthenticated(actor);
  const recipientId = input.recipientId ?? buyer.userId;
  const gift = recipientId !== buyer.userId;
  if (gift) requirePermission(ctx, current, "shop.gift");
  const row = item(ctx, input.itemId);
  const value = itemValue(ctx, row);
  const parent = category(ctx, row.category_id);
  // Inactive, or hidden from the buyer by its rule or its category's.
  const unavailable =
    !row.is_active || !parent.is_active || allowedBy(ctx, current, [parent, row]).length < 2;
  if (unavailable && !can(ctx, current, "admin.shop")) throw new NotFoundError();
  if (gift) {
    if (!value.isGiftable) throw new ForbiddenError("This gift cannot be sent.");
    if (!statement(ctx, shopSql.recipient).get(recipientId)) throw new NotFoundError();
    requireNotErased(ctx, recipientId);
    // The recipient must meet the item's rule and its category's too. The refusal is the one the
    // buyer would get for an item they cannot see, so it does not say why (or that a rule exists).
    if (!allAllowFor(ctx, recipientId, [parent, row])) throw new NotFoundError();
    if (
      can(ctx, current, "member.ignorable") &&
      statement(ctx, shopSql.ignored).get(recipientId, buyer.userId)
    )
      throw new ForbiddenError("This gift cannot be sent.");
  }
  if (unavailable) throw new ConflictError("This item is not available.");
  if (!value.isConsumable && input.quantity !== 1)
    throw new ValidationError("This item takes quantity 1.");
  if (upgrade && value.effect.type !== "group")
    throw new ValidationError("Only a rank (a group item) can be upgraded to.");
  const replaced = upgrade
    ? (statement<InventoryRow & { price: number }>(ctx, currentRankSql).get(
        buyer.userId,
        value.categoryId,
        ctx.now(),
      ) ?? null)
    : null;
  if (replaced && value.price <= replaced.price) throw new ConflictError("Ranks only go up.");
  if (
    !value.isConsumable &&
    value.effect.type === "permission" &&
    alreadyHolds(ctx, recipientId, value.effect.permission)
  )
    throw new ConflictError("The recipient already has this permission.");
  const now = ctx.now();
  const credit = replaced ? rankCredit(replaced, now) : 0;
  const price = Math.max(0, value.price * input.quantity - credit);
  // What the recipient now holds is worth what was paid plus the credit carried over.
  const paid = price + credit;
  let groupsRemoved: number[] = [];
  if (replaced) {
    // The old rank leaves the held states and takes its group with it, before the new one comes.
    const left = statement(
      ctx,
      "UPDATE shop_inventory SET state = 'expired', updated_at = ?1 WHERE id = ?2 AND user_id = ?3 AND state = 'active'",
    ).run(now, replaced.id, buyer.userId).changes;
    if (!left) throw new ConflictError("The current rank changed; try again.");
    groupsRemoved = revokePurchased(ctx, replaced.id).groupsRemoved;
    releaseUnheldWear(ctx, buyer.userId);
  }
  if (!value.isConsumable) expireLapsedRow(ctx, recipientId, value.id, now);
  const held = value.isConsumable
    ? statement<InventoryRow>(
        ctx,
        "INSERT INTO shop_inventory (user_id, item_id, state, quantity, paid_price, acquired_at, updated_at) VALUES (?1, ?2, 'unused', ?3, ?5, ?4, ?4) ON CONFLICT (user_id, item_id) DO UPDATE SET quantity = shop_inventory.quantity + excluded.quantity, paid_price = shop_inventory.paid_price + excluded.paid_price, state = 'unused', updated_at = excluded.updated_at RETURNING *",
      ).get(recipientId, value.id, input.quantity, now, paid)!
    : statement<InventoryRow>(
        ctx,
        "INSERT INTO shop_inventory (user_id, item_id, state, quantity, expires_at, paid_price, acquired_at, updated_at) VALUES (?1, ?2, 'active', 1, ?3, ?5, ?4, ?4) ON CONFLICT (user_id, item_id) DO UPDATE SET state = 'active', quantity = 1, expires_at = excluded.expires_at, paid_price = excluded.paid_price, acquired_at = excluded.acquired_at, updated_at = excluded.updated_at WHERE shop_inventory.state = 'expired' RETURNING *",
      ).get(
        recipientId,
        value.id,
        value.durationSeconds === null ? null : now + value.durationSeconds * 1000,
        now,
        paid,
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
  // The purchase id must exist before the charge so the ledger can reference it.
  const bought = statement<PurchaseRow>(
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
            source: { type: "shop_purchase", id: bought.id },
          },
        ])[0]!.balance;
  statement(
    ctx,
    "UPDATE users SET shop_purchase_count = shop_purchase_count + ?1 WHERE id = ?2",
  ).run(input.quantity, buyer.userId);
  let groupAdded = false;
  if (
    (!value.isConsumable || held.quantity === input.quantity) &&
    (value.effect.type === "permission" || value.effect.type === "group")
  )
    groupAdded = grantPurchased(ctx, recipientId, held.id, value.effect).groupAdded;
  if (groupAdded || groupsRemoved.length)
    publishEvent(ctx, {
      type: "member.groups_changed",
      targetType: "user",
      targetId: recipientId,
      payload: {
        added: groupAdded && value.effect.type === "group" ? [value.effect.groupId] : [],
        removed: groupsRemoved,
        source: "shop",
      },
    });
  publishEvent(ctx, {
    type: "shop.purchased",
    targetType: "shop_purchase",
    targetId: bought.id,
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
    purchase: purchaseValues(ctx, [bought])[0]!,
    balance,
    inventory: gift ? null : inventoryValue(held, value),
    replacedItemId: replaced?.item_id ?? null,
  };
}

export const buy = implement(contracts.shopBuy, (ctx, actor, input) => {
  requireAuthenticated(actor);
  return writeTx(ctx, () => {
    const { replacedItemId: _replaced, ...bought } = purchase(ctx, actor, input);
    return bought;
  });
});

export const upgrade = implement(contracts.shopUpgrade, (ctx, actor, input) => {
  requireAuthenticated(actor);
  return writeTx(ctx, () => {
    const result = purchase(ctx, actor, { itemId: input.itemId, quantity: 1 }, true);
    return { ...result, inventory: result.inventory! };
  });
});

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

export const use = implement(contracts.shopUse, (ctx, actor, input) => {
  requireAuthenticated(actor);
  return writeTx(ctx, () => {
    const current = currentActor(ctx, actor);
    requirePermission(ctx, current, "shop.buy");
    const member = requireAuthenticated(actor);
    const row = statement<InventoryRow>(ctx, shopSql.ownInventory).get(
      input.inventoryId,
      member.userId,
    );
    if (!row) throw new NotFoundError();
    const value = itemValue(ctx, item(ctx, row.item_id));
    const effect = value.effect;
    if (effect.type === "group" || (effect.type === "permission" && !value.isConsumable))
      throw new ConflictError("This item applies while held and cannot be used.");
    if (effect.type === "frame" || effect.type === "nameColor" || effect.type === "nameIcon")
      throw new ConflictError("Wear this item with appearance.set.");
    if (effect.type === "usernameChange")
      throw new ConflictError("Spend this item with users.changeUsername.");
    const needsThread =
      effect.type === "threadCover" ||
      effect.type === "highlight" ||
      effect.type === "bump" ||
      effect.type === "promote";
    if (needsThread !== (input.threadId !== undefined))
      throw new ValidationError(
        needsThread ? "A thread is required." : "This item does not take a thread.",
      );
    if (needsThread) {
      const thread = statement<{
        user_id: number;
        node_id: number;
        state: string;
        merged_into_id: number | null;
        is_locked: number;
      }>(ctx, shopSql.thread).get(input.threadId!);
      if (
        !thread ||
        thread.user_id !== member.userId ||
        thread.state !== "visible" ||
        thread.merged_into_id !== null
      )
        throw new NotFoundError();
      requirePermission(ctx, current, "node.view", { nodeId: thread.node_id }, { notFound: true });
      // A promotion of a locked thread would advertise one nobody can answer.
      if (effect.type === "promote" && thread.is_locked)
        throw new ConflictError("A locked thread cannot be promoted.");
    }
    // An inactive entry still applies, since the member paid for it; one without a picture
    // cannot be drawn.
    if (effect.type === "threadCover" && !catalogImageById(ctx, effect.coverId)?.image)
      throw new ConflictError("This cover has no picture yet.");
    const now = ctx.now();
    if (effect.type === "promote" && featureKinds(ctx, [input.threadId!], now).has(input.threadId!))
      throw new ConflictError("This thread is already featured.");
    // The expiry job marks a lapsed row up to a minute late: it cannot be used meanwhile.
    if (row.expires_at !== null && row.expires_at <= now)
      throw new ConflictError("This item has expired.");
    let used = row;
    if (value.isConsumable) {
      const changed = statement<InventoryRow>(
        ctx,
        "UPDATE shop_inventory SET quantity = quantity - 1, state = CASE WHEN quantity = 1 THEN 'used' ELSE 'unused' END, updated_at = ?1 WHERE id = ?2 AND user_id = ?3 AND state = 'unused' AND quantity > 0 RETURNING *",
      ).get(now, row.id, member.userId);
      if (!changed) throw new ConflictError("No units are left.");
      used = changed;
      if (used.quantity === 0) {
        revokePurchased(ctx, row.id);
        releaseUnheldWear(ctx, member.userId);
      }
    } else if (row.state !== "active") throw new ConflictError("This item is not active.");
    if (effect.type === "promote")
      addFeature(ctx, {
        threadId: input.threadId!,
        kind: "paid",
        userId: member.userId,
        now,
        endsAt: now + PAID_FEATURE_MS,
      });
    else if (needsThread) {
      // The thread edit: no counter, last-post column or read state moves. A bump only sets
      // bumped_at, and the generated sort_at moves the thread by itself.
      statement(
        ctx,
        effect.type === "threadCover"
          ? "UPDATE threads SET cover_id = ?2, content_updated_at = ?3 WHERE id = ?1"
          : effect.type === "highlight"
            ? "UPDATE threads SET highlighted_until = max(?3, COALESCE(highlighted_until, 0)) + ?2, content_updated_at = ?3 WHERE id = ?1"
            : "UPDATE threads SET bumped_at = ?3, content_updated_at = ?3 WHERE id = ?1",
      ).run(
        input.threadId!,
        effect.type === "threadCover"
          ? effect.coverId
          : effect.type === "highlight"
            ? effect.days * 86_400_000
            : null,
        now,
      );
    }
    publishEvent(ctx, {
      type: "shop.item_used",
      targetType: "shop_inventory",
      targetId: row.id,
      payload: {
        userId: member.userId,
        itemId: value.id,
        effect,
        ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
        quantityLeft: used.quantity,
      },
    });
    return inventoryValue(used, value);
  });
});

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
