import { describe, expect, test } from "bun:test";
import type { Ctx } from "../context";
import { createTestContext, insertUser } from "../testing";
import {
  attachPurchasedItems,
  CRITERIA_USER_COLUMNS,
  type Criterion,
  criterionIds,
  eligible,
  type MemberFacts,
} from "./criteria";

const facts = (overrides: Partial<MemberFacts> = {}): MemberFacts => ({
  post_count: 0,
  created_at: 0,
  reaction_score: 0,
  email_verified: 0,
  avatar_file_id: null,
  last_activity_at: null,
  warning_points: 0,
  credits: 0,
  shop_purchase_count: 0,
  ...overrides,
});
const NOW = 10_000_000;
const check = (member: MemberFacts, criterion: string, value: number) =>
  eligible(member, [{ criterion, value }], NOW);

function shopItem(ctx: Ctx, name: string): number {
  const category = ctx.sqlite
    .prepare<{ id: number }, []>(
      "INSERT INTO shop_categories (name, created_at, updated_at) VALUES ('Cat', 0, 0) RETURNING id",
    )
    .get()!.id;
  return ctx.sqlite
    .prepare<{ id: number }, [number, string]>(
      "INSERT INTO shop_items (category_id, name, price, effect, created_at, updated_at) VALUES (?1, ?2, 5, '{}', 0, 0) RETURNING id",
    )
    .get(category, name)!.id;
}

function purchase(ctx: Ctx, buyerId: number, itemId: number) {
  ctx.sqlite
    .prepare(
      "INSERT INTO shop_purchases (item_id, buyer_id, recipient_id, price, created_at) VALUES (?1, ?2, ?2, 5, 0)",
    )
    .run(itemId, buyerId);
}

describe("economy criteria in eligible", () => {
  test("the new criteria are registered", () => {
    for (const id of [
      "credits_at_least",
      "credits_at_most",
      "purchased_item",
      "purchases_at_least",
    ])
      expect(criterionIds.has(id)).toBe(true);
  });

  test("credits_at_least is inclusive", () => {
    expect(check(facts({ credits: 99 }), "credits_at_least", 100)).toBe(false);
    expect(check(facts({ credits: 100 }), "credits_at_least", 100)).toBe(true);
    expect(check(facts({ credits: 101 }), "credits_at_least", 100)).toBe(true);
    expect(check(facts({ credits: -5 }), "credits_at_least", 0)).toBe(false);
    expect(check(facts({ credits: -5 }), "credits_at_least", -5)).toBe(true);
  });

  test("credits_at_most is inclusive and counts negative balances", () => {
    expect(check(facts({ credits: 101 }), "credits_at_most", 100)).toBe(false);
    expect(check(facts({ credits: 100 }), "credits_at_most", 100)).toBe(true);
    expect(check(facts({ credits: -40 }), "credits_at_most", 0)).toBe(true);
    expect(check(facts({ credits: 0 }), "credits_at_most", 0)).toBe(true);
  });

  test("purchases_at_least reads the purchase counter", () => {
    expect(check(facts({ shop_purchase_count: 2 }), "purchases_at_least", 3)).toBe(false);
    expect(check(facts({ shop_purchase_count: 3 }), "purchases_at_least", 3)).toBe(true);
    expect(check(facts({ shop_purchase_count: 0 }), "purchases_at_least", 0)).toBe(true);
  });

  test("purchased_item needs the item among the attached ids, and is false when none attached", () => {
    expect(check(facts(), "purchased_item", 7)).toBe(false);
    expect(check(facts({ purchased_item_ids: new Set() }), "purchased_item", 7)).toBe(false);
    expect(check(facts({ purchased_item_ids: new Set([8]) }), "purchased_item", 7)).toBe(false);
    expect(check(facts({ purchased_item_ids: new Set([7, 8]) }), "purchased_item", 7)).toBe(true);
  });

  test("all conditions must hold, and an unknown criterion never does", () => {
    const member = facts({ credits: 50, shop_purchase_count: 1 });
    const conditions: Criterion[] = [
      { criterion: "credits_at_least", value: 50 },
      { criterion: "purchases_at_least", value: 1 },
    ];
    expect(eligible(member, conditions, NOW)).toBe(true);
    expect(
      eligible(member, [...conditions, { criterion: "credits_at_most", value: 49 }], NOW),
    ).toBe(false);
    expect(eligible(member, [{ criterion: "made_up", value: 0 }], NOW)).toBe(false);
    expect(eligible(member, [], NOW)).toBe(true);
  });

  test("CRITERIA_USER_COLUMNS selects the economy facts from users", () => {
    const ctx = createTestContext();
    const user = insertUser(ctx);
    ctx.sqlite
      .prepare("UPDATE users SET credits = 12, shop_purchase_count = 3 WHERE id = ?1")
      .run(user.id);
    const row = ctx.sqlite
      .prepare<{ credits: number; shop_purchase_count: number }, [number]>(
        `SELECT ${CRITERIA_USER_COLUMNS} FROM users u WHERE u.id = ?1`,
      )
      .get(user.id)!;
    expect(row).toMatchObject({ credits: 12, shop_purchase_count: 3 });
  });
});

describe("attachPurchasedItems", () => {
  const member = (id: number): MemberFacts & { id: number } => ({ id, ...facts() });

  test("loads only the items some condition asks about", () => {
    const ctx = createTestContext();
    const buyer = insertUser(ctx);
    const wanted = shopItem(ctx, "Wanted");
    const other = shopItem(ctx, "Other");
    purchase(ctx, buyer.id, wanted);
    purchase(ctx, buyer.id, other);
    const m = member(buyer.id);
    attachPurchasedItems(ctx, [m], [[{ criterion: "purchased_item", value: wanted }]]);
    expect([...m.purchased_item_ids!]).toEqual([wanted]);
    expect(eligible(m, [{ criterion: "purchased_item", value: wanted }], NOW)).toBe(true);
    expect(eligible(m, [{ criterion: "purchased_item", value: other }], NOW)).toBe(false);
  });

  test("only purchased_item conditions count; other criteria with the same value are ignored", () => {
    const ctx = createTestContext();
    const buyer = insertUser(ctx);
    const item = shopItem(ctx, "Item");
    purchase(ctx, buyer.id, item);
    const m = member(buyer.id);
    attachPurchasedItems(ctx, [m], [[{ criterion: "purchases_at_least", value: item }]]);
    expect(m.purchased_item_ids).toBeUndefined();
  });

  test("runs no query when no condition asks or there are no members", () => {
    const ctx = createTestContext();
    const buyer = insertUser(ctx);
    const item = shopItem(ctx, "Item");
    purchase(ctx, buyer.id, item);
    const statements: string[] = [];
    const sqlite = ctx.sqlite;
    const original = sqlite.prepare.bind(sqlite);
    (sqlite as { prepare: unknown }).prepare = (sql: string) => {
      statements.push(sql);
      return original(sql);
    };
    try {
      const m = member(buyer.id);
      attachPurchasedItems(ctx, [m], [[{ criterion: "post_count", value: 1 }], []]);
      attachPurchasedItems(ctx, [m], []);
      attachPurchasedItems(ctx, [], [[{ criterion: "purchased_item", value: item }]]);
      expect(m.purchased_item_ids).toBeUndefined();
      expect(statements.filter((sql) => sql.includes("shop_purchases"))).toEqual([]);
    } finally {
      (sqlite as { prepare: unknown }).prepare = original;
    }
  });

  test("loads several members and several lists of conditions in one call", () => {
    const ctx = createTestContext();
    const [a, b, c] = [insertUser(ctx), insertUser(ctx), insertUser(ctx)];
    const x = shopItem(ctx, "X");
    const y = shopItem(ctx, "Y");
    const z = shopItem(ctx, "Z");
    purchase(ctx, a.id, x);
    purchase(ctx, a.id, x); // bought twice: still one entry
    purchase(ctx, a.id, y);
    purchase(ctx, b.id, y);
    purchase(ctx, b.id, z); // nobody asks about z
    const members = [member(a.id), member(b.id), member(c.id)];
    attachPurchasedItems(ctx, members, [
      [{ criterion: "purchased_item", value: x }],
      [
        { criterion: "post_count", value: 3 },
        { criterion: "purchased_item", value: y },
      ],
    ]);
    expect([...members[0]!.purchased_item_ids!].sort()).toEqual([x, y].sort());
    expect([...members[1]!.purchased_item_ids!]).toEqual([y]);
    expect(members[2]!.purchased_item_ids).toBeUndefined();
  });

  test("a gift counts for the buyer, not the recipient", () => {
    const ctx = createTestContext();
    const buyer = insertUser(ctx);
    const recipient = insertUser(ctx);
    const item = shopItem(ctx, "Gift");
    ctx.sqlite
      .prepare(
        "INSERT INTO shop_purchases (item_id, buyer_id, recipient_id, price, created_at) VALUES (?1, ?2, ?3, 5, 0)",
      )
      .run(item, buyer.id, recipient.id);
    const members = [member(buyer.id), member(recipient.id)];
    attachPurchasedItems(ctx, members, [[{ criterion: "purchased_item", value: item }]]);
    expect(members[0]!.purchased_item_ids?.has(item)).toBe(true);
    expect(members[1]!.purchased_item_ids).toBeUndefined();
  });

  test("an item nobody bought attaches nothing", () => {
    const ctx = createTestContext();
    const buyer = insertUser(ctx);
    const item = shopItem(ctx, "Unsold");
    const m = member(buyer.id);
    attachPurchasedItems(ctx, [m], [[{ criterion: "purchased_item", value: item }]]);
    expect(m.purchased_item_ids).toBeUndefined();
  });
});
