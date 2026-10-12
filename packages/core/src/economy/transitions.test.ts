import { afterEach, expect, test } from "bun:test";
import { closeContext } from "../context";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { userActor } from "../testing";
import {
  assertInvariants,
  balances,
  databaseSnapshot,
  drainEvents,
  drainJobs,
  economySnapshot,
  expire,
  random,
  replayTwice,
  rows,
  setup,
} from "./helpers";

const fixtures: ReturnType<typeof setup>[] = [];
function fixture() {
  const f = setup();
  fixtures.push(f);
  return f;
}
afterEach(() => {
  for (const { ctx } of fixtures.splice(0)) closeContext(ctx);
});

test("seeded purchase attempts preserve every durable row on rejection", async () => {
  const { ctx, act, members, stocks } = fixture();
  const buyer = userActor(members[0]!);
  const recipient = userActor(members[1]!);
  await act("credits.adjust", { userId: members[0]!.id, amount: 23, reason: "Purchase budget" });
  const category = await act("shopCategories.create", { name: "Rollback" });
  const hidden = await act("shopCategories.create", { name: "Hidden", isActive: false });
  const items = [];
  for (const [name, price, stock, isActive, isGiftable, categoryId] of [
    ["Affordable", 3, 4, true, true, category.id],
    ["Too expensive", 100, 8, true, true, category.id],
    ["Sold out", 1, 0, true, true, category.id],
    ["Inactive", 1, 8, false, true, category.id],
    ["Not giftable", 1, 8, true, false, category.id],
    ["Inactive category", 1, 8, true, true, hidden.id],
  ] as const) {
    const item = await act("shopItems.create", {
      categoryId,
      name,
      price,
      stock,
      isActive,
      isGiftable,
      isConsumable: true,
      effect: { type: "permission", permission: "forum.bypassNodeRules" },
    });
    items.push(item);
    stocks.set(item.id, stock);
  }
  await act("users.ignore", { userId: members[0]!.id }, recipient);
  const rng = random(0x51a7);
  const failures = new Set<string>();
  let successes = 0;
  for (let step = 0; step < 80; step++) {
    // The first six attempts guarantee each failure class, subsequent attempts vary quantities.
    const choice = step < 6 ? step : rng(items.length);
    const item = items[choice]!;
    const gift = choice === 4 || (choice === 0 && (step === 0 || rng(3) === 0));
    const input = {
      itemId: item.id,
      quantity: 1 + rng(3),
      ...(gift ? { recipientId: members[1]!.id } : {}),
    };
    const before = databaseSnapshot(ctx);
    let error: unknown;
    try {
      await act("shop.buy", input, buyer);
      successes++;
    } catch (caught) {
      error = caught;
    }
    if (error) {
      // Unavailable items are hidden from a buyer without admin.shop, before any gift check.
      const hiddenFromBuyer = choice === 3 || choice === 5;
      expect(error).toBeInstanceOf(
        hiddenFromBuyer ? NotFoundError : gift ? ForbiddenError : ConflictError,
      );
      expect(databaseSnapshot(ctx), `rejected purchase ${step}: ${item.name}`).toEqual(before);
      failures.add(item.name);
    }
    expect(rows(ctx, "SELECT id, credits FROM users WHERE credits < 0")).toEqual([]);
    assertInvariants(ctx, stocks);
  }
  // With admin.shop an unavailable item is a conflict, still without any durable change.
  for (const item of [items[3]!, items[5]!]) {
    const before = databaseSnapshot(ctx);
    await expect(act("shop.buy", { itemId: item.id })).rejects.toBeInstanceOf(ConflictError);
    expect(databaseSnapshot(ctx), `admin purchase of ${item.name}`).toEqual(before);
  }
  expect(successes).toBeGreaterThan(0);
  expect([...failures].sort()).toEqual(items.map((item) => item.name).sort());
  await replayTwice(ctx, stocks);
});

for (const kind of ["thread", "post", "profile_post"] as const) {
  test(`${kind}: author and moderator delete/restore preserve original rewards through rule edits and deletion`, async () => {
    const { ctx, act, members, moderator, node } = fixture();
    const author = userActor(members[0]!);
    const mod = userActor(moderator);
    // Thread deletion and restoration require moderation grants even for the author.
    await act("permissions.set", {
      userId: members[0]!.id,
      entries: [
        { permission: "forum.undelete", value: "allow" },
        { permission: "forum.deleteAny", value: "allow" },
        { permission: "forum.viewDeleted", value: "allow" },
        { permission: "profilePost.undelete", value: "allow" },
        { permission: "profilePost.viewDeleted", value: "allow" },
      ],
    });
    const triggers =
      kind === "thread"
        ? ["thread_created"]
        : kind === "post"
          ? ["reply_posted", "reply_received"]
          : ["profile_post_created", "profile_post_received"];
    const rules = [];
    for (const trigger of triggers)
      rules.push(await act("creditRules.create", { title: trigger, trigger, amount: 7 }));
    const parent = await act(
      "threads.create",
      { nodeId: node.id, title: "Parent", body: "Parent body" },
      userActor(members[1]!),
    );
    const source =
      kind === "thread"
        ? await act(
            "threads.create",
            { nodeId: node.id, title: "Rewarded thread", body: "Thread body" },
            author,
          )
        : kind === "post"
          ? await act(
              "posts.create",
              { threadId: parent.thread.id, body: "Rewarded reply" },
              author,
            )
          : await act(
              "profilePosts.create",
              { userId: members[1]!.id, body: "Rewarded profile post" },
              author,
            );
    await drainEvents(ctx);
    const original = balances(ctx);
    const prefix = kind === "thread" ? "threads" : kind === "post" ? "posts" : "profilePosts";
    const input = {
      [kind === "thread" ? "threadId" : kind === "post" ? "postId" : "profilePostId"]:
        kind === "thread" ? source.thread.id : source.id,
    };
    for (let cycle = 0; cycle < 6; cycle++) {
      const actor = cycle % 2 === 0 ? author : mod;
      await act(`${prefix}.delete`, input, actor);
      await drainEvents(ctx);
      assertInvariants(ctx);
      if (cycle < 3) {
        for (const rule of rules)
          await act("creditRules.update", {
            ruleId: rule.id,
            amount: 101 + cycle,
            isActive: cycle % 2 === 0,
          });
      } else if (cycle === 3) {
        for (const rule of rules) await act("creditRules.delete", { ruleId: rule.id });
        await act("creditRules.create", {
          title: "Replacement",
          trigger: triggers[0],
          amount: 999,
        });
      }
      await act(`${prefix}.restore`, input, actor);
      await drainEvents(ctx);
      expect(balances(ctx), `cycle ${cycle}`).toEqual(original);
      assertInvariants(ctx);
    }
    await replayTwice(ctx);
  });
}

test("an inactive rule pays nothing, on dispatch or on replay, and activating it pays no history", async () => {
  const { ctx, act, node, members } = fixture();
  const rule = await act("creditRules.create", {
    title: "Inactive",
    trigger: "thread_created",
    amount: 9,
    isActive: false,
  });
  await act(
    "threads.create",
    { nodeId: node.id, title: "Historical", body: "Already processed" },
    userActor(members[0]!),
  );
  await drainEvents(ctx);
  expect(rows(ctx, "SELECT id FROM credit_rule_applications")).toEqual([]);
  // Replays with the rule untouched change nothing (a manual cursor reset plus a rule edit is
  // outside the guarantee, see DECISIONS.md).
  await replayTwice(ctx);
  expect(rows(ctx, "SELECT id FROM credit_rule_applications")).toEqual([]);
  expect(rows(ctx, "SELECT id FROM credit_transactions")).toEqual([]);
  // Activating the rule does not pay the thread that already passed; a new one is paid once.
  await act("creditRules.update", { ruleId: rule.id, isActive: true });
  await drainEvents(ctx);
  expect(rows(ctx, "SELECT id FROM credit_rule_applications")).toEqual([]);
  await act(
    "threads.create",
    { nodeId: node.id, title: "Later", body: "Paid" },
    userActor(members[0]!),
  );
  await drainEvents(ctx);
  expect(rows(ctx, "SELECT id FROM credit_rule_applications")).toHaveLength(1);
  expect(rows(ctx, "SELECT credits FROM users WHERE id = ?1", members[0]!.id)).toEqual([
    { credits: 9 },
  ]);
  assertInvariants(ctx);
  // A cursor reset after activating the rule is the out-of-guarantee case; a plain re-dispatch
  // must change nothing.
  const settled = economySnapshot(ctx);
  await drainEvents(ctx);
  expect(economySnapshot(ctx)).toEqual(settled);
});

test("a source excluded by a rule limit stays unpaid on replay with the limit unchanged", async () => {
  const { ctx, act, node, members } = fixture();
  await act("creditRules.create", {
    title: "Limited",
    trigger: "thread_created",
    amount: 9,
    limit: { count: 1, windowHours: 1 },
  });
  for (let i = 0; i < 2; i++)
    await act(
      "threads.create",
      {
        nodeId: node.id,
        title: `Limited ${i}`,
        body: "One reward only",
      },
      userActor(members[0]!),
    );
  await drainEvents(ctx);
  expect(rows(ctx, "SELECT id FROM credit_rule_applications")).toHaveLength(1);
  expect(rows(ctx, "SELECT credits FROM users WHERE id = ?1", members[0]!.id)).toEqual([
    { credits: 9 },
  ]);
  // Changing the limit and resetting the cursor by hand is outside the guarantee (DECISIONS.md).
  await replayTwice(ctx);
  expect(rows(ctx, "SELECT id FROM credit_rule_applications")).toHaveLength(1);
  assertInvariants(ctx);
});

for (const kind of ["thread", "post", "profile_post"] as const) {
  test(`${kind}: creation first dispatched while deleted is never paid, and re-dispatching changes nothing`, async () => {
    const { ctx, act, node, members, moderator } = fixture();
    const author = userActor(members[0]!);
    const mod = userActor(moderator);
    const trigger =
      kind === "thread"
        ? "thread_created"
        : kind === "post"
          ? "reply_posted"
          : "profile_post_created";
    await act("creditRules.create", { title: trigger, trigger, amount: 9 });
    const parent = await act(
      "threads.create",
      { nodeId: node.id, title: "Delayed events", body: "Thread" },
      author,
    );
    const source =
      kind === "thread"
        ? parent.thread
        : kind === "post"
          ? await act("posts.create", { threadId: parent.thread.id, body: "Reply" }, author)
          : await act(
              "profilePosts.create",
              { userId: members[1]!.id, body: "Profile post" },
              author,
            );
    const prefix = kind === "thread" ? "threads" : kind === "post" ? "posts" : "profilePosts";
    const input = {
      [kind === "thread" ? "threadId" : kind === "post" ? "postId" : "profilePostId"]: source.id,
    };
    await act(`${prefix}.delete`, input, mod);
    await drainEvents(ctx);
    assertInvariants(ctx);
    // The documented limit: content hidden before the subscriber first saw it is not paid later.
    const unpaid = balances(ctx);
    expect(rows(ctx, "SELECT id FROM credit_rule_applications")).toEqual([]);
    await act(`${prefix}.restore`, input, mod);
    await drainEvents(ctx);
    assertInvariants(ctx);
    expect(rows(ctx, "SELECT id FROM credit_rule_applications")).toEqual([]);
    expect(rows(ctx, "SELECT id FROM credit_transactions")).toEqual([]);
    expect(balances(ctx)).toEqual(unpaid);
    // Dispatching again without resetting the cursor is a no-op.
    const settled = economySnapshot(ctx);
    await drainEvents(ctx);
    await drainEvents(ctx);
    expect(economySnapshot(ctx)).toEqual(settled);
    assertInvariants(ctx);
  });
}

test("a gift unlocks the buyer's automatic award once, and revocation uses its original XP and credits", async () => {
  const { ctx, act, members } = fixture();
  const buyerId = members[0]!.id;
  const recipientId = members[1]!.id;
  await act("creditRules.create", { title: "Award bonus", trigger: "award_received", amount: 3 });
  await act("credits.adjust", { userId: buyerId, amount: 30, reason: "Gift budget" });
  const category = await act("shopCategories.create", { name: "Achievements" });
  const item = await act("shopItems.create", {
    categoryId: category.id,
    name: "Gift",
    price: 10,
    isConsumable: true,
    isGiftable: true,
    effect: { type: "frame", frame: "gift" },
  });
  const award = await act("awards.create", {
    name: "Generous",
    tier: "gold",
    xp: 7,
    credits: 11,
    criteria: [{ criterion: "purchased_item", value: item.id }],
  });
  await act("shop.buy", { itemId: item.id, recipientId }, userActor(members[0]!));
  await drainEvents(ctx);
  assertInvariants(ctx);
  expect(
    rows(ctx, "SELECT credits, award_xp, shop_purchase_count FROM users WHERE id = ?1", buyerId),
  ).toEqual([{ credits: 34, award_xp: 7, shop_purchase_count: 1 }]);
  expect(
    rows(
      ctx,
      "SELECT credits, award_xp, shop_purchase_count FROM users WHERE id = ?1",
      recipientId,
    ),
  ).toEqual([{ credits: 0, award_xp: 0, shop_purchase_count: 0 }]);
  const grants = rows<{ id: number; user_id: number; granted_by: number | null }>(
    ctx,
    "SELECT id, user_id, granted_by FROM member_awards",
  );
  expect(grants).toEqual([{ id: grants[0]!.id, user_id: buyerId, granted_by: null }]);
  await act("awards.update", { awardId: award.id, xp: 700, credits: 1100 });
  await act("awards.revoke", { memberAwardId: grants[0]!.id });
  await drainEvents(ctx);
  assertInvariants(ctx);
  expect(rows(ctx, "SELECT credits, award_xp FROM users WHERE id = ?1", buyerId)).toEqual([
    { credits: 20, award_xp: 0 },
  ]);
  for (let sweep = 0; sweep < 2; sweep++) {
    await act("awards.run");
    await drainJobs(ctx);
    await drainEvents(ctx);
    assertInvariants(ctx);
    expect(rows(ctx, "SELECT count, auto_granted FROM member_award_totals")).toEqual([
      { count: 0, auto_granted: 1 },
    ]);
    expect(rows(ctx, "SELECT id FROM member_awards")).toHaveLength(1);
  }
  await replayTwice(ctx);
});

test("consumable grants end at the last unit; temporary gifts expire and can be bought again", async () => {
  const { ctx, act, members, stocks } = fixture();
  const buyer = userActor(members[0]!);
  const recipient = userActor(members[1]!);
  await act("credits.adjust", { userId: members[0]!.id, amount: 100, reason: "Grant lifecycle" });
  const category = await act("shopCategories.create", { name: "Lifecycle" });
  for (const effect of [
    { type: "permission", permission: "forum.bypassNodeRules" },
    { type: "group", groupId: 2 },
  ]) {
    const item = await act("shopItems.create", {
      categoryId: category.id,
      name: effect.type,
      price: 5,
      stock: 4,
      isGiftable: true,
      durationSeconds: 60,
      effect,
    });
    stocks.set(item.id, 4);
    await act("shop.buy", { itemId: item.id, recipientId: members[1]!.id }, buyer);
    assertInvariants(ctx, stocks);
    ctx.clock.advance(60_000);
    await expire(ctx);
    expect(rows(ctx, "SELECT state FROM shop_inventory WHERE item_id = ?1", item.id)).toEqual([
      { state: "expired" },
    ]);
    assertInvariants(ctx, stocks);
    await act("shop.buy", { itemId: item.id, recipientId: members[1]!.id }, buyer);
    assertInvariants(ctx, stocks);
  }
  const consumable = await act("shopItems.create", {
    categoryId: category.id,
    name: "Units",
    price: 2,
    isConsumable: true,
    isGiftable: true,
    effect: { type: "permission", permission: "forum.bypassNodeRules" },
  });
  await act("shop.buy", { itemId: consumable.id, recipientId: members[1]!.id, quantity: 2 }, buyer);
  const { id } = rows<{ id: number }>(
    ctx,
    "SELECT id FROM shop_inventory WHERE item_id = ?1",
    consumable.id,
  )[0]!;
  for (const quantity of [1, 0]) {
    const inventory = await act("shop.use", { inventoryId: id }, recipient);
    expect(inventory.quantity).toBe(quantity);
    assertInvariants(ctx, stocks);
  }
  const before = databaseSnapshot(ctx);
  await expect(act("shop.use", { inventoryId: id }, recipient)).rejects.toBeInstanceOf(
    ConflictError,
  );
  expect(databaseSnapshot(ctx)).toEqual(before);
  await act("shop.buy", { itemId: consumable.id, recipientId: members[1]!.id }, buyer);
  assertInvariants(ctx, stocks);
  await replayTwice(ctx, stocks);
});

test("balance repair completes multiple chunks without altering any ledger row", async () => {
  const { ctx, act, members } = fixture();
  const { insertUser } = await import("../testing");
  const all = [...members, ...Array.from({ length: 205 }, () => insertUser(ctx))];
  for (let i = 0; i < all.length; i++) {
    if (i % 3 !== 0)
      await act("credits.adjust", {
        userId: all[i]!.id,
        amount: i % 2 ? i + 1 : -i - 1,
        reason: "Repair source",
      });
  }
  const expected = balances(ctx);
  const ledger = rows(ctx, "SELECT * FROM credit_transactions ORDER BY id");
  ctx.sqlite.exec("UPDATE users SET credits = credits + 12345");
  expect(await act("credits.recalculate")).toEqual({ queued: true });
  await drainJobs(ctx);
  expect(balances(ctx)).toEqual(expected);
  expect(rows(ctx, "SELECT * FROM credit_transactions ORDER BY id")).toEqual(ledger);
  assertInvariants(ctx);
  await act("credits.recalculate");
  await drainJobs(ctx);
  expect(rows(ctx, "SELECT * FROM credit_transactions ORDER BY id")).toEqual(ledger);
  await replayTwice(ctx);
});
