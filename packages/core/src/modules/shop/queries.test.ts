import { expect, test } from "bun:test";
import { createTestContext, expectNoTableScan, insertUser, userActor } from "@sermo/core/testing";
import { closeContext } from "../../context";
import { type AnyOperation, execute } from "../../operation";
import { insertCatalogImage } from "../appearance/catalog-fixtures";
import { itemsSql, purchasesSql, shopSql } from "./data";
import { expireShopBatch } from "./expiry";
import { operations } from "./index";

test("prepared catalog and inventory writes also avoid scans", async () => {
  const ctx = createTestContext();
  try {
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const buyer = userActor(insertUser(ctx));
    const recipient = insertUser(ctx);
    const frameId = insertCatalogImage(ctx, "frame");
    const call = (name: string, input: unknown, actor = admin) =>
      execute(ctx, operations.find((op) => op.name === name)! as AnyOperation, actor, input);
    const category = await call("shopCategories.create", { name: "Catalog" });
    await call("shopCategories.update", { categoryId: category.id, name: "Updated" });
    const item = await call("shopItems.create", {
      categoryId: category.id,
      name: "Frame",
      price: 0,
      isConsumable: true,
      isGiftable: true,
      stock: 10,
      effect: { type: "permission", permission: "profile.signature" },
    });
    await call("shopItems.update", { itemId: item.id, stock: 20 });
    const held = await call("shop.buy", { itemId: item.id }, buyer);
    await call("shop.buy", { itemId: item.id, recipientId: recipient.id }, buyer);
    await call("shop.use", { inventoryId: held.inventory.id }, buyer);
    const temporary = await call("shopItems.create", {
      categoryId: category.id,
      name: "Temporary",
      price: 0,
      durationSeconds: 60,
      effect: { type: "frame", frameId },
    });
    await call("shop.buy", { itemId: temporary.id }, buyer);
    ctx.clock.advance(60_000);
    expireShopBatch(ctx);
    await call("shop.buy", { itemId: temporary.id }, buyer);
    const emptyCategory = await call("shopCategories.create", { name: "Empty" });
    const unused = await call("shopItems.create", {
      categoryId: emptyCategory.id,
      name: "Unsold",
      price: 0,
      effect: { type: "bump" },
    });
    await call("shopItems.delete", { itemId: unused.id });
    await call("shopCategories.delete", { categoryId: emptyCategory.id });
    const queries = [...ctx.statements.keys()]
      .filter((key) => key.startsWith("shop."))
      .map((key) => key.slice(5));
    expect(queries.length).toBeGreaterThan(15);
    for (const sql of queries) {
      const bindings = Math.max(
        0,
        ...[...sql.matchAll(/\?(\d+)/g)].map((match) => Number(match[1])),
      );
      expectNoTableScan(ctx, sql, Array(bindings).fill(null));
    }
  } finally {
    closeContext(ctx);
  }
});

test("shop hot lookups, keysets and expiry use matching indexes", () => {
  const ctx = createTestContext();
  try {
    // Categories are a small configuration table, explicitly allowed by the query-plan helper.
    expectNoTableScan(ctx, shopSql.categories, [], { allowTempBTree: true });
    for (const sql of [
      shopSql.category,
      shopSql.item,
      shopSql.categoryItems,
      shopSql.bought,
      shopSql.recipient,
      shopSql.thread,
      shopSql.group,
    ])
      expectNoTableScan(ctx, sql, [1]);
    expectNoTableScan(ctx, shopSql.items, ["[1,2,3]"]);
    expectNoTableScan(ctx, shopSql.inventory, [1, "active", ctx.now(), 1000, 21]);
    expectNoTableScan(ctx, shopSql.ownInventory, [1, 1]);
    expectNoTableScan(ctx, shopSql.ignored, [1, 2]);
    expectNoTableScan(ctx, shopSql.expiry, [ctx.now(), 10]);
    for (const admin of [false, true]) expectNoTableScan(ctx, itemsSql(admin), [1, 0, 1, 21]);
    for (const buyer of [false, true])
      for (const item of [false, true]) {
        const sql = purchasesSql(buyer, item);
        const params = [Number.MAX_SAFE_INTEGER, ...(buyer ? [1] : []), ...(item ? [1] : []), 21];
        expectNoTableScan(ctx, sql, params);
        const plan = ctx.sqlite
          .prepare<{ detail: string }, number[]>(`EXPLAIN QUERY PLAN ${sql}`)
          .all(...params)
          .map((row) => row.detail)
          .join("\n");
        if (buyer && item) expect(plan).toContain("shop_purchases_buyer_item");
        else if (buyer) expect(plan).toContain("shop_purchases_buyer");
        else if (item) expect(plan).toContain("shop_purchases_item");
        else expect(plan).toContain("INTEGER PRIMARY KEY");
      }
    for (const [sql, params] of [
      ["UPDATE shop_items SET stock = stock - ?1 WHERE id = ?2 AND stock >= ?1", [1, 1]],
      ["UPDATE users SET shop_purchase_count = shop_purchase_count + ?1 WHERE id = ?2", [1, 1]],
      [
        "UPDATE shop_inventory SET state = 'expired', updated_at = ?1 WHERE id = ?2 AND state = 'active' AND expires_at <= ?1",
        [ctx.now(), 1],
      ],
      [
        "UPDATE shop_inventory SET quantity = quantity - 1, state = CASE WHEN quantity = 1 THEN 'used' ELSE 'unused' END, updated_at = ?1 WHERE id = ?2 AND user_id = ?3 AND state = 'unused' AND quantity > 0 RETURNING *",
        [ctx.now(), 1, 1],
      ],
    ] as const)
      expectNoTableScan(ctx, sql, [...params]);
  } finally {
    closeContext(ctx);
  }
});
