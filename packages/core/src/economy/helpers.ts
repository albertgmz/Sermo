import type { SQLQueryBindings } from "bun:sqlite";
import { expect } from "bun:test";
import type { Actor } from "../actor";
import type { Ctx } from "../context";
import { dispatchEvents } from "../events";
import { registerAwardJobs } from "../modules/awards";
import { registerCreditRuleJobs } from "../modules/credit-events";
import { registerCreditJobs } from "../modules/credits";
import { enqueueJob, runDueJobs } from "../modules/jobs/queue";
import { registerShopJobs } from "../modules/shop";
import { execute } from "../operation";
import { getOperation } from "../operations";
import { createTestContext, insertNode, insertUser, userActor } from "../testing";

export const call = (ctx: Ctx, name: string, actor: Actor, input: unknown = {}) =>
  execute(ctx, getOperation(name), actor, input);

export function rows<T>(ctx: Ctx, sql: string, ...params: SQLQueryBindings[]): T[] {
  return ctx.sqlite.prepare<T, SQLQueryBindings[]>(sql).all(...params);
}

export function setup() {
  const ctx = createTestContext();
  registerCreditRuleJobs(ctx);
  registerAwardJobs(ctx);
  registerCreditJobs(ctx);
  registerShopJobs(ctx);
  const adminUser = insertUser(ctx, { groupId: 4 });
  const moderator = insertUser(ctx, { groupId: 3 });
  const members = Array.from({ length: 3 }, () => insertUser(ctx));
  const admin = userActor(adminUser);
  const node = insertNode(ctx, {});
  const stocks = new Map<number, number>();
  const act = (name: string, input: unknown = {}, actor = admin) => call(ctx, name, actor, input);
  return { ctx, adminUser, admin, moderator, members, node, stocks, act };
}

export async function drainEvents(ctx: Ctx) {
  for (let batch = 0; batch < 100; batch++) {
    if ((await dispatchEvents(ctx, { budgetMs: 1000 })) === 0) return;
  }
  throw new Error("Economy subscribers did not reach a fixed point");
}

export async function drainJobs(ctx: Ctx) {
  for (let batch = 0; batch < 100; batch++) {
    if ((await runDueJobs(ctx, { limit: 10 })) === 0) {
      expect(rows(ctx, "SELECT type, status, last_error FROM jobs WHERE status != 'done'")).toEqual(
        [],
      );
      return;
    }
  }
  throw new Error("Economy jobs did not finish");
}

export async function expire(ctx: Ctx) {
  enqueueJob(ctx, "shop.expire", {}, { uniqueKey: "shop.expire" });
  await drainJobs(ctx);
}

export function balances(ctx: Ctx) {
  return rows(ctx, "SELECT id, credits FROM users ORDER BY id");
}

const economyTables = [
  "credit_transactions",
  "credit_rule_applications",
  "credit_rules",
  "awards",
  "member_awards",
  "member_award_totals",
  "shop_items",
  "shop_inventory",
  "shop_purchases",
  "shop_permission_grants",
  "shop_group_grants",
];

export function economySnapshot(ctx: Ctx) {
  return {
    users: rows(ctx, "SELECT id, credits, award_xp, shop_purchase_count FROM users ORDER BY id"),
    ...Object.fromEntries(
      economyTables.map((table) => [table, rows(ctx, `SELECT * FROM ${table} ORDER BY id`)]),
    ),
  };
}

/** Includes events, audit logs, permission versions, sequences and all other durable effects. */
export function databaseSnapshot(ctx: Ctx) {
  const tables = rows<{ name: string }>(
    ctx,
    "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
  );
  return Object.fromEntries(
    tables.map(({ name }) => [
      name,
      rows(ctx, `SELECT * FROM "${name.replaceAll('"', '""')}"`)
        .map((row) => JSON.stringify(row))
        .sort(),
    ]),
  );
}

export async function replayTwice(ctx: Ctx, stocks: ReadonlyMap<number, number> = new Map()) {
  await drainEvents(ctx);
  const before = economySnapshot(ctx);
  const snapshots = [];
  for (let replay = 1; replay <= 2; replay++) {
    ctx.sqlite.exec("UPDATE event_subscribers SET last_event_id = 0");
    await drainEvents(ctx);
    snapshots.push(economySnapshot(ctx));
    assertInvariants(ctx, stocks);
  }
  for (const [index, snapshot] of snapshots.entries())
    expect(snapshot, `replay ${index + 1}`).toEqual(before);
}

/** Independent aggregates deliberately avoid production counter/reconciliation helpers. */
export function assertInvariants(ctx: Ctx, stocks: ReadonlyMap<number, number> = new Map()) {
  expect(
    rows(
      ctx,
      `SELECT u.id, u.credits, COALESCE(SUM(t.amount), 0) AS ledger
    FROM users u LEFT JOIN credit_transactions t ON t.user_id = u.id
    GROUP BY u.id HAVING u.credits != ledger`,
    ),
    "balance equals ledger",
  ).toEqual([]);
  expect(
    rows(
      ctx,
      `SELECT * FROM (SELECT id, user_id, balance_after,
    SUM(amount) OVER (PARTITION BY user_id ORDER BY id ROWS UNBOUNDED PRECEDING) AS running
    FROM credit_transactions) WHERE balance_after != running`,
    ),
    "ledger running balances",
  ).toEqual([]);
  expect(
    rows(
      ctx,
      `SELECT u.id, u.award_xp, COALESCE(SUM(g.xp), 0) AS held_xp FROM users u
    LEFT JOIN member_awards g ON g.user_id = u.id AND g.revoked_at IS NULL
    GROUP BY u.id HAVING u.award_xp != held_xp`,
    ),
    "held grant XP",
  ).toEqual([]);
  expect(
    rows(
      ctx,
      `SELECT t.user_id, t.award_id, t.count, COUNT(g.id) AS held
    FROM member_award_totals t LEFT JOIN member_awards g ON g.user_id = t.user_id
    AND g.award_id = t.award_id AND g.revoked_at IS NULL
    GROUP BY t.id HAVING t.count != held`,
    ),
    "per-member award totals",
  ).toEqual([]);
  expect(
    rows(
      ctx,
      `SELECT g.id FROM member_awards g LEFT JOIN member_award_totals t
    ON t.user_id = g.user_id AND t.award_id = g.award_id WHERE t.id IS NULL`,
    ),
    "no missing totals",
  ).toEqual([]);
  expect(
    rows(
      ctx,
      `SELECT a.id, a.grant_count, COUNT(g.id) AS held FROM awards a
    LEFT JOIN member_awards g ON g.award_id = a.id AND g.revoked_at IS NULL
    GROUP BY a.id HAVING a.grant_count != held`,
    ),
    "catalog grant counts",
  ).toEqual([]);
  expect(
    rows(
      ctx,
      `SELECT g.user_id, g.award_id, COUNT(*) AS held FROM member_awards g
    JOIN awards a ON a.id = g.award_id WHERE a.is_stackable = 0 AND g.revoked_at IS NULL
    GROUP BY g.user_id, g.award_id HAVING held > 1`,
    ),
    "unique non-stackable grants",
  ).toEqual([]);
  expect(
    rows(
      ctx,
      `SELECT u.id, u.shop_purchase_count, COALESCE(SUM(p.quantity), 0) AS bought
    FROM users u LEFT JOIN shop_purchases p ON p.buyer_id = u.id
    GROUP BY u.id HAVING u.shop_purchase_count != bought`,
    ),
    "buyer purchase count, including gifts",
  ).toEqual([]);
  expect(
    rows(ctx, "SELECT id, stock FROM shop_items WHERE stock < 0"),
    "stock never negative",
  ).toEqual([]);
  for (const [id, initial] of stocks) {
    expect(
      rows(
        ctx,
        `SELECT i.stock, ?2 - COALESCE(SUM(p.quantity), 0) AS remaining
      FROM shop_items i LEFT JOIN shop_purchases p ON p.item_id = i.id WHERE i.id = ?1
      GROUP BY i.id HAVING i.stock != remaining`,
        id,
        initial,
      ),
      `stock conservation for item ${id}`,
    ).toEqual([]);
  }
  expect(
    rows(ctx, "SELECT id, quantity FROM shop_inventory WHERE quantity < 0"),
    "inventory never negative",
  ).toEqual([]);
  for (const kind of ["permission", "group"] as const) {
    const actual = rows(
      ctx,
      `SELECT inventory_id, user_id FROM shop_${kind}_grants ORDER BY inventory_id, user_id`,
    );
    const expected = rows(
      ctx,
      `SELECT v.id AS inventory_id, v.user_id FROM shop_inventory v
      JOIN shop_items i ON i.id = v.item_id WHERE json_extract(i.effect, '$.type') = ?1
      AND (v.state = 'active' OR (v.state = 'unused' AND v.quantity > 0)) ORDER BY v.id, v.user_id`,
      kind,
    );
    expect(actual, `exactly held ${kind} grants`).toEqual(expected);
  }
  // Hiding a thread intentionally leaves its replies' earned credits in place (DECISIONS.md).
  // Reaction removal and unfollowing also do not undo an earned payment.
  expect(
    rows(
      ctx,
      `SELECT a.id, a.source_type, a.source_id, a.state FROM credit_rule_applications a
    LEFT JOIN threads t ON a.source_type = 'thread' AND t.id = a.source_id
    LEFT JOIN posts p ON a.source_type = 'post' AND p.id = a.source_id
    LEFT JOIN profile_posts pp ON a.source_type = 'profile_post' AND pp.id = a.source_id
    LEFT JOIN member_awards g ON a.source_type = 'member_award' AND g.id = a.source_id
    WHERE a.state != CASE
      WHEN a.source_type = 'thread' THEN CASE WHEN t.state = 'visible' THEN 'applied' ELSE 'reverted' END
      WHEN a.source_type = 'post' THEN CASE WHEN p.state = 'visible' THEN 'applied' ELSE 'reverted' END
      WHEN a.source_type = 'profile_post' THEN CASE WHEN pp.state = 'visible' THEN 'applied' ELSE 'reverted' END
      WHEN a.source_type = 'member_award' THEN CASE WHEN g.revoked_at IS NULL THEN 'applied' ELSE 'reverted' END
      ELSE 'applied' END`,
    ),
    "applications follow source visibility",
  ).toEqual([]);
}

/** xorshift32: reproducible across platforms; never use wall time for a seed. */
export function random(seed: number) {
  let state = seed | 0;
  return (max: number) => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) % max;
  };
}
