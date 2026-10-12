import { afterEach, expect, test } from "bun:test";
import { closeContext } from "../context";
import { enqueueJob } from "../modules/jobs/queue";
import { insertUser, userActor } from "../testing";
import { assertInvariants, call, drainEvents, replayTwice, rows, setup } from "./helpers";
import { type RaceTask, race } from "./race";

const fixtures: ReturnType<typeof setup>[] = [];
function fixture() {
  const f = setup();
  fixtures.push(f);
  return f;
}
afterEach(() => {
  for (const { ctx } of fixtures.splice(0)) closeContext(ctx);
});

for (const scarce of ["stock", "balance"] as const) {
  test(`separate connections: exactly one buyer wins scarce ${scarce}`, async () => {
    const { ctx, act, members, stocks } = fixture();
    members.push(insertUser(ctx));
    for (const user of members)
      await act("credits.adjust", { userId: user.id, amount: 10, reason: "One unit" });
    const category = await act("shopCategories.create", { name: "Contended" });
    const item = await act("shopItems.create", {
      categoryId: category.id,
      name: scarce,
      price: 10,
      stock: scarce === "stock" ? 1 : 2,
      isConsumable: true,
      effect: { type: "permission", permission: "forum.bypassNodeRules" },
    });
    stocks.set(item.id, scarce === "stock" ? 1 : 2);
    const buyers = scarce === "stock" ? members : [members[0]!, members[0]!];
    await race(
      ctx,
      buyers.map((user) => ({
        kind: "operation",
        name: "shop.buy",
        actor: userActor(user),
        input: { itemId: item.id },
      })),
      async (db, results) => {
        expect(results.filter((result) => result.status === "ok")).toEqual([
          { status: "ok", completed: 1 },
        ]);
        expect(results.filter((result) => result.status === "conflict")).toHaveLength(
          buyers.length - 1,
        );
        expect(rows(db, "SELECT quantity, price FROM shop_purchases")).toEqual([
          { quantity: 1, price: 10 },
        ]);
        expect(rows(db, "SELECT id FROM users WHERE credits < 0")).toEqual([]);
        expect(rows(db, "SELECT quantity FROM shop_inventory")).toEqual([{ quantity: 1 }]);
        await drainEvents(db);
        assertInvariants(db, stocks);
        await replayTwice(db, stocks);
      },
    );
  }, 15_000);
}

test("separate connections: two non-stackable grants award XP and credits exactly once", async () => {
  const { ctx, act, members, admin } = fixture();
  await act("creditRules.create", { title: "Award receipt", trigger: "award_received", amount: 3 });
  const award = await act("awards.create", {
    name: "Unique race",
    tier: "gold",
    xp: 7,
    credits: 11,
  });
  const task: RaceTask = {
    kind: "operation",
    name: "awards.grant",
    actor: admin,
    input: { userId: members[0]!.id, awardId: award.id },
  };
  await race(ctx, [task, task], async (db, results) => {
    expect(results.map((result) => result.status).sort()).toEqual(["conflict", "ok"]);
    expect(results.reduce((sum, result) => sum + result.completed, 0)).toBe(1);
    await drainEvents(db);
    expect(rows(db, "SELECT credits, award_xp FROM users WHERE id = ?1", members[0]!.id)).toEqual([
      { credits: 14, award_xp: 7 },
    ]);
    expect(rows(db, "SELECT id FROM member_awards")).toHaveLength(1);
    assertInvariants(db);
    await replayTwice(db);
  });
}, 15_000);

test("separate connections: using the last permission unit twice consumes it once", async () => {
  const { ctx, act, members, stocks } = fixture();
  const actor = userActor(members[0]!);
  await act("credits.adjust", { userId: members[0]!.id, amount: 10, reason: "One use" });
  const category = await act("shopCategories.create", { name: "Last unit" });
  const item = await act("shopItems.create", {
    categoryId: category.id,
    name: "Permission",
    price: 10,
    stock: 1,
    isConsumable: true,
    effect: { type: "permission", permission: "forum.bypassNodeRules" },
  });
  stocks.set(item.id, 1);
  const bought = await act("shop.buy", { itemId: item.id }, actor);
  const task: RaceTask = {
    kind: "operation",
    name: "shop.use",
    actor,
    input: { inventoryId: bought.inventory.id },
  };
  await race(ctx, [task, task], async (db, results) => {
    expect(results.map((result) => result.status).sort()).toEqual(["conflict", "ok"]);
    expect(results.reduce((sum, result) => sum + result.completed, 0)).toBe(1);
    expect(rows(db, "SELECT quantity, state FROM shop_inventory")).toEqual([
      { quantity: 0, state: "used" },
    ]);
    expect(rows(db, "SELECT id FROM domain_events WHERE type = 'shop.item_used'")).toHaveLength(1);
    await drainEvents(db);
    assertInvariants(db, stocks);
    await replayTwice(db, stocks);
  });
}, 15_000);

test("separate connections: renewal racing expiry has one of the two serial outcomes", async () => {
  const { ctx, act, members, stocks } = fixture();
  const actor = userActor(members[0]!);
  await act("credits.adjust", { userId: members[0]!.id, amount: 30, reason: "Renewal" });
  const category = await act("shopCategories.create", { name: "Expiry race" });
  const item = await act("shopItems.create", {
    categoryId: category.id,
    name: "Temporary permission",
    price: 10,
    stock: 2,
    durationSeconds: 60,
    effect: { type: "permission", permission: "forum.bypassNodeRules" },
  });
  stocks.set(item.id, 2);
  await act("shop.buy", { itemId: item.id }, actor);
  ctx.clock.advance(60_000);
  enqueueJob(ctx, "shop.expire", {});
  await race(
    ctx,
    [{ kind: "operation", name: "shop.buy", actor, input: { itemId: item.id } }, { kind: "jobs" }],
    async (db, results) => {
      expect(results[1]).toEqual({ status: "ok", completed: 1 });
      const renewed = results[0]!.status === "ok";
      expect(results[0]!.completed).toBe(renewed ? 1 : 0);
      expect(rows(db, "SELECT state, expires_at FROM shop_inventory")).toEqual([
        { state: renewed ? "active" : "expired", expires_at: ctx.now() + (renewed ? 60_000 : 0) },
      ]);
      expect(rows(db, "SELECT id FROM shop_purchases")).toHaveLength(renewed ? 2 : 1);
      expect(rows(db, "SELECT credits FROM users WHERE id = ?1", members[0]!.id)).toEqual([
        { credits: renewed ? 10 : 20 },
      ]);
      await drainEvents(db);
      assertInvariants(db, stocks);
      // A refusal before expiry must leave the same opportunity available after the job completes.
      if (!renewed) await call(db, "shop.buy", actor, { itemId: item.id });
      expect(rows(db, "SELECT stock FROM shop_items")).toEqual([{ stock: 0 }]);
      assertInvariants(db, stocks);
      await replayTwice(db, stocks);
    },
  );
}, 15_000);

test("separate connections: adjustments racing multi-chunk balance repair lose no movements", async () => {
  const { ctx, act, admin, members } = fixture();
  const extra = Array.from({ length: 205 }, () => insertUser(ctx));
  const target = members[0]!;
  await act("credits.adjust", { userId: target.id, amount: 20, reason: "Existing ledger" });
  // Corrupt unrelated members; the moving member starts consistent, so its historical ledger
  // balances remain meaningful even when its adjustment wins before the repair transaction.
  for (const user of extra)
    ctx.sqlite.prepare("UPDATE users SET credits = 999 WHERE id = ?1").run(user.id);
  await act("credits.recalculate");
  await race(
    ctx,
    [
      {
        kind: "operation",
        name: "credits.adjust",
        actor: admin,
        input: { userId: target.id, amount: 1, reason: "Concurrent movement" },
        repetitions: 80,
      },
      { kind: "jobs" },
    ],
    async (db, results) => {
      expect(results[0]).toEqual({ status: "ok", completed: 80 });
      expect(results[1]).toEqual({ status: "ok", completed: 3 });
      expect(rows(db, "SELECT credits FROM users WHERE id = ?1", target.id)).toEqual([
        { credits: 100 },
      ]);
      expect(rows(db, "SELECT id FROM credit_transactions")).toHaveLength(81);
      expect(rows(db, "SELECT DISTINCT credits FROM users WHERE id != ?1", target.id)).toEqual([
        { credits: 0 },
      ]);
      await drainEvents(db);
      assertInvariants(db);
      await replayTwice(db);
    },
  );
}, 15_000);
