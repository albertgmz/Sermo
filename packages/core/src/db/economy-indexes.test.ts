import { describe, expect, test } from "bun:test";
import { getTableColumns } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { createTestContext, expectNoTableScan } from "../testing";
import * as schema from "./schema";

describe("economy queries use indexes", () => {
  const ctx = createTestContext();
  const queries: [string, unknown[]][] = [
    [
      "SELECT * FROM credit_transactions WHERE user_id = ?1 AND id < ?2 ORDER BY id DESC LIMIT 21",
      [1, 100],
    ],
    ["SELECT * FROM credit_transactions WHERE id < ?1 ORDER BY id DESC LIMIT 21", [100]],
    [
      "SELECT id FROM credit_rule_applications WHERE source_type = ?1 AND source_id = ?2",
      ["post", 1],
    ],
    [
      "SELECT count(*) FROM credit_rule_applications WHERE rule_id = ?1 AND user_id = ?2 AND created_at > ?3",
      [1, 1, 0],
    ],
    [
      "SELECT id FROM credit_rule_applications WHERE rule_id = ?1 AND user_id = ?2 AND source_type = ?3 AND source_id = ?4 AND source_user_id = ?5",
      [1, 1, "post", 1, 0],
    ],
    [
      "SELECT * FROM member_awards WHERE user_id = ?1 AND revoked_at IS NULL AND id < ?2 ORDER BY id DESC LIMIT 21",
      [1, 100],
    ],
    [
      "SELECT * FROM member_awards WHERE award_id = ?1 AND revoked_at IS NULL AND id < ?2 ORDER BY id DESC LIMIT 21",
      [1, 100],
    ],
    ["SELECT * FROM member_award_totals WHERE user_id = ?1 AND count > 0", [1]],
    [
      "SELECT * FROM shop_items WHERE category_id = ?1 AND (position, id) > (?2, ?3) ORDER BY position, id LIMIT 21",
      [1, 0, 0],
    ],
    ["SELECT * FROM shop_inventory WHERE user_id = ?1 AND item_id = ?2", [1, 1]],
    [
      "SELECT * FROM shop_inventory WHERE user_id = ?1 AND state = ?2 AND (updated_at, id) < (?3, ?4) ORDER BY updated_at DESC, id DESC LIMIT 21",
      [1, "active", 1000, 100],
    ],
    [
      "SELECT id FROM shop_inventory WHERE state = 'active' AND expires_at <= ?1 ORDER BY expires_at LIMIT 100",
      [1000],
    ],
    ["SELECT * FROM shop_purchases WHERE id < ?1 ORDER BY id DESC LIMIT 21", [100]],
    [
      "SELECT * FROM shop_purchases WHERE buyer_id = ?1 AND id < ?2 ORDER BY id DESC LIMIT 21",
      [1, 100],
    ],
    [
      "SELECT * FROM shop_purchases WHERE item_id = ?1 AND id < ?2 ORDER BY id DESC LIMIT 21",
      [1, 100],
    ],
    [
      "SELECT * FROM shop_purchases WHERE buyer_id = ?1 AND item_id = ?2 AND id < ?3 ORDER BY id DESC LIMIT 21",
      [1, 1, 100],
    ],
    ["SELECT 1 FROM shop_purchases WHERE buyer_id = ?1 AND item_id = ?2 LIMIT 1", [1, 1]],
  ];
  for (const [sql, params] of queries)
    test(sql, () => {
      expectNoTableScan(ctx, sql, params);
    });
});

describe("schema matches the migration", () => {
  const ctx = createTestContext();
  const tables: [string, SQLiteTable][] = [
    ["credit_transactions", schema.creditTransactions],
    ["credit_rules", schema.creditRules],
    ["credit_rule_applications", schema.creditRuleApplications],
    ["awards", schema.awards],
    ["member_awards", schema.memberAwards],
    ["member_award_totals", schema.memberAwardTotals],
    ["shop_categories", schema.shopCategories],
    ["shop_items", schema.shopItems],
    ["shop_inventory", schema.shopInventory],
    ["shop_purchases", schema.shopPurchases],
    ["shop_permission_grants", schema.shopPermissionGrants],
    ["shop_group_grants", schema.shopGroupGrants],
  ];
  const tableInfo = (table: string) =>
    ctx.sqlite
      .prepare<{ name: string; type: string; notnull: number; dflt_value: string | null }, []>(
        `PRAGMA table_info(${table})`,
      )
      .all();

  for (const [table, definition] of tables)
    test(`${table} columns`, () => {
      const database = tableInfo(table)
        .map((column) => column.name)
        .sort();
      expect(database.length).toBeGreaterThan(0);
      const drizzle = Object.values(getTableColumns(definition))
        .map((column) => column.name)
        .sort();
      expect(drizzle).toEqual(database);
    });

  test("users has the economy counters defaulting to 0", () => {
    const columns = new Map(tableInfo("users").map((column) => [column.name, column]));
    for (const name of ["credits", "award_xp", "shop_purchase_count"]) {
      const column = columns.get(name);
      expect(column, name).toBeDefined();
      expect(column!.dflt_value).toBe("0");
      expect(column!.notnull).toBe(1);
    }
  });

  test("new members start with zero credits, award xp and purchases", () => {
    ctx.sqlite
      .prepare(
        "INSERT INTO auth_user (id, name, email, email_verified, username, display_username, created_at, updated_at) VALUES (1, 'a', 'a@x.test', 0, 'a', 'a', 0, 0)",
      )
      .run();
    ctx.sqlite
      .prepare(
        "INSERT INTO users (id, username, username_key, group_id, created_at) VALUES (1, 'a', 'a', 2, 0)",
      )
      .run();
    expect(
      ctx.sqlite
        .prepare<{ credits: number; award_xp: number; shop_purchase_count: number }, []>(
          "SELECT credits, award_xp, shop_purchase_count FROM users WHERE id = 1",
        )
        .get(),
    ).toEqual({ credits: 0, award_xp: 0, shop_purchase_count: 0 });
  });
});
