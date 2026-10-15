import type { SQLQueryBindings } from "bun:sqlite";
import type * as z from "zod";
import { type Ctx, prepared } from "../../context";
import { ShopEffect, type ShopItem } from "../../contracts/shop";
import type { ShopInventoryState } from "../../db/schema";
import { NotFoundError } from "../../errors";
import { everyone, parseRule } from "../../shared/criteria";
import { loadUserSummaries } from "../../shared/users";
import { iso, isoOrNull } from "../../time";
import { publicPicture } from "../storage/url";

export type Effect = z.infer<typeof ShopEffect>;
export type Item = z.infer<typeof ShopItem>;
export type CategoryRow = {
  id: number;
  name: string;
  description: string;
  position: number;
  is_active: number;
  rule: string;
  created_at: number;
  updated_at: number;
};
export type ItemRow = CategoryRow & {
  category_id: number;
  icon: string;
  image_file_id: number | null;
  price: number;
  stock: number | null;
  is_consumable: number;
  is_giftable: number;
  duration_seconds: number | null;
  effect: string;
};
export type InventoryRow = {
  id: number;
  user_id: number;
  item_id: number;
  state: ShopInventoryState;
  quantity: number;
  expires_at: number | null;
  paid_price: number;
  acquired_at: number;
  updated_at: number;
};
export type PurchaseRow = {
  id: number;
  item_id: number;
  buyer_id: number;
  recipient_id: number;
  quantity: number;
  price: number;
  created_at: number;
};

export const shopSql = {
  categories: "SELECT * FROM shop_categories ORDER BY position, id",
  category: "SELECT * FROM shop_categories WHERE id = ?1",
  item: "SELECT * FROM shop_items WHERE id = ?1",
  items: "SELECT * FROM shop_items WHERE id IN (SELECT value FROM json_each(?1))",
  categoryItems: "SELECT id FROM shop_items WHERE category_id = ?1 LIMIT 1",
  bought: "SELECT id FROM shop_purchases WHERE item_id = ?1 LIMIT 1",
  inventory:
    "SELECT * FROM shop_inventory WHERE user_id = ?1 AND state = ?2 AND (updated_at, id) < (?3, ?4) ORDER BY updated_at DESC, id DESC LIMIT ?5",
  ownInventory: "SELECT * FROM shop_inventory WHERE id = ?1 AND user_id = ?2",
  recipient: "SELECT id, credits FROM users WHERE id = ?1",
  ignored: "SELECT 1 FROM user_ignores WHERE user_id = ?1 AND ignored_id = ?2",
  thread: "SELECT user_id, node_id, state, merged_into_id, is_locked FROM threads WHERE id = ?1",
  group: "SELECT rank FROM groups WHERE id = ?1",
  expiry:
    "SELECT id, user_id FROM shop_inventory WHERE state = 'active' AND expires_at <= ?1 ORDER BY expires_at, id LIMIT ?2",
};

export function statement<T>(ctx: Ctx, sql: string) {
  return prepared(ctx, `shop.${sql}`, () => ctx.sqlite.prepare<T, SQLQueryBindings[]>(sql));
}
export function category(ctx: Ctx, id: number): CategoryRow {
  const row = statement<CategoryRow>(ctx, shopSql.category).get(id);
  if (!row) throw new NotFoundError();
  return row;
}
export function item(ctx: Ctx, id: number): ItemRow {
  const row = statement<ItemRow>(ctx, shopSql.item).get(id);
  if (!row) throw new NotFoundError();
  return row;
}
/** The rule is shown only to those who manage the shop (`withRule`); everyone else gets an empty one. */
export const categoryValue = (row: CategoryRow, withRule = false) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  position: row.position,
  isActive: !!row.is_active,
  rule: withRule ? parseRule(row.rule) : everyone(),
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});
/** The stored effect, which only this module writes: anything else is damage, reported by its item. */
function parseEffect(row: ItemRow): Effect {
  try {
    const parsed = ShopEffect.safeParse(JSON.parse(row.effect));
    if (parsed.success) return parsed.data;
  } catch {
    // Not JSON at all: reported below like any other unreadable value.
  }
  throw new Error(`The stored effect of shop item ${row.id} cannot be read.`);
}
export const itemValue = (ctx: Ctx, row: ItemRow, withRule = false): Item => ({
  ...categoryValue(row, withRule),
  categoryId: row.category_id,
  icon: row.icon,
  image: publicPicture(ctx, row.image_file_id),
  price: row.price,
  stock: row.stock,
  isConsumable: !!row.is_consumable,
  isGiftable: !!row.is_giftable,
  durationSeconds: row.duration_seconds,
  effect: parseEffect(row),
});
export function loadItems(ctx: Ctx, ids: number[]): Map<number, Item> {
  return new Map(
    statement<ItemRow>(ctx, shopSql.items)
      .all(JSON.stringify([...new Set(ids)]))
      .map((row) => [row.id, itemValue(ctx, row)]),
  );
}
export const inventoryValue = (row: InventoryRow, heldItem: Item) => ({
  id: row.id,
  userId: row.user_id,
  item: heldItem,
  state: row.state,
  quantity: row.quantity,
  expiresAt: isoOrNull(row.expires_at),
  acquiredAt: iso(row.acquired_at),
  updatedAt: iso(row.updated_at),
});
export function purchaseValues(ctx: Ctx, rows: PurchaseRow[]) {
  const items = loadItems(
    ctx,
    rows.map((row) => row.item_id),
  );
  const users = loadUserSummaries(
    ctx,
    rows.flatMap((row) => [row.buyer_id, row.recipient_id]),
  );
  return rows.map((row) => ({
    id: row.id,
    item: { id: row.item_id, name: items.get(row.item_id)!.name },
    buyer: users(row.buyer_id),
    recipient: users(row.recipient_id),
    quantity: row.quantity,
    price: row.price,
    createdAt: iso(row.created_at),
  }));
}
export function itemsSql(admin: boolean): string {
  return `SELECT * FROM shop_items WHERE category_id = ?1 AND (position, id) > (?2, ?3)${admin ? "" : " AND is_active = 1"} ORDER BY position, id LIMIT ?4`;
}
export function purchasesSql(buyer: boolean, purchasedItem: boolean): string {
  // Rowid is also the final key of the buyer/item index, including when both are fixed.
  return `SELECT * FROM shop_purchases WHERE id < ?1${buyer ? " AND buyer_id = ?2" : ""}${purchasedItem ? ` AND item_id = ?${buyer ? 3 : 2}` : ""} ORDER BY id DESC LIMIT ?${2 + Number(buyer) + Number(purchasedItem)}`;
}
