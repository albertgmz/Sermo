import { afterEach, describe, expect, test } from "bun:test";
import {
  type Contract,
  contracts as c,
  dispatchEvents,
  enqueueJob,
  registerCreditRuleJobs,
  registerShopJobs,
  runDueJobs,
} from "@sermo/core";
import type * as z from "zod";
import {
  type Auth,
  cleanupEconomy,
  deny,
  error,
  fixture,
  missingId,
  setup,
} from "./economy-fixtures.test";

afterEach(cleanupEconomy);
async function pages<O extends z.ZodType<{ items: { id: number }[]; nextCursor: string | null }>>(
  f: Pick<Awaited<ReturnType<typeof setup>>, "api" | "send">,
  contract: Contract<z.ZodType, O>,
  url: string,
  auth: Auth,
  ids: number[],
) {
  const base = `${url}${url.includes("?") ? "&" : "?"}limit=1`;
  let cursor: string | null = null;
  for (const [index, id] of ids.entries()) {
    const page: z.output<O> = await f.api(
      contract,
      "GET",
      `${base}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      auth,
    );
    expect(page.items.map((item) => item.id)).toEqual([id]);
    cursor = page.nextCursor;
    if (index === ids.length - 1) expect(cursor).toBeNull();
    else expect(cursor).toEqual(expect.any(String));
  }
  for (const cursor of ["not-base64-json", Buffer.from('["wrong-type"]').toString("base64url")]) {
    await error(f.send("GET", `${base}&cursor=${cursor}`, auth), 400, "validation", ["cursor"]);
  }
}

test("credit history and ledger paginate, filter numeric userId, and keep balances private", async () => {
  const f = await fixture("key");
  const adjustment = await f.fund(f.member.id, 7);
  const otherAdjustment = await f.fund(f.other.id, 20);
  const full = await f.api(c.creditsHistory, "GET", "/credits", f.member.auth);
  expect(full.balance).toBe(97);
  expect(full.items.map((row) => row.userId)).toEqual([f.member.id, f.member.id, f.member.id]);
  const ids = full.items.map((row) => row.id);
  expect(ids[0]).toBe(adjustment.id);
  await pages(f, c.creditsHistory, "/credits", f.member.auth, ids);
  await pages(f, c.creditsLedger, `/credits/ledger?userId=${f.member.id}`, f.admin.auth, ids);
  const all = await f.api(c.creditsLedger, "GET", "/credits/ledger", f.admin.auth);
  expect(all.balance).toBeNull();
  expect(all.items.map((row) => row.id)).toEqual([otherAdjustment.id, ...ids]);
  await pages(f, c.creditsLedger, "/credits/ledger", f.admin.auth, [otherAdjustment.id, ...ids]);
  const attemptedOverride = await f.api(
    c.creditsHistory,
    "GET",
    `/credits?userId=${f.other.id}`,
    f.member.auth,
  );
  expect(attemptedOverride).toEqual(full);
});

test("award holders and member grants paginate without mixing award or member IDs", async () => {
  const f = await fixture();
  const second = await f.api(
    c.awardsGrant,
    "POST",
    `/users/${f.member.id}/awards`,
    f.admin.auth,
    { awardId: f.award.id },
    201,
  );
  const third = await f.api(
    c.awardsGrant,
    "POST",
    `/users/${f.other.id}/awards`,
    f.admin.auth,
    { awardId: f.award.id },
    201,
  );
  const unrelated = await f.api(
    c.awardsGrant,
    "POST",
    `/users/${f.other.id}/awards`,
    f.admin.auth,
    { awardId: f.ungrantedAward.id },
    201,
  );
  await pages(f, c.awardsHolders, `/awards/${f.award.id}/holders`, {}, [
    third.id,
    second.id,
    f.grant.id,
  ]);
  await pages(f, c.awardsMemberGrants, `/users/${f.member.id}/award-grants`, {}, [
    second.id,
    f.grant.id,
  ]);
  const held = await f.api(c.awardsMember, "GET", `/users/${f.member.id}/awards`, {});
  expect(held).toMatchObject({ xp: 14, items: [{ award: { id: f.award.id }, count: 2 }] });
  const other = await f.api(
    c.awardsMemberGrants,
    "GET",
    `/users/${f.other.id}/award-grants?limit=1`,
    {},
  );
  expect(other.items.map((row) => row.id)).toEqual([unrelated.id]);
});

test("shop listings, inventory and purchase filters paginate with numeric IDs and limits", async () => {
  const f = await fixture("key");
  const extra = await f.api(
    c.shopItemsCreate,
    "POST",
    "/shop/items",
    f.admin.auth,
    {
      categoryId: f.category.id,
      name: "Extra",
      price: 1,
      isConsumable: true,
      effect: { type: "permission", permission: "profile.signature" },
      position: 2,
    },
    201,
  );
  const excluded = await f.api(
    c.shopItemsCreate,
    "POST",
    "/shop/items",
    f.admin.auth,
    { categoryId: f.emptyCategory.id, name: "Other category", price: 0, effect: { type: "bump" } },
    201,
  );
  await pages(f, c.shopItemsList, `/shop/categories/${f.category.id}/items`, {}, [
    f.item.id,
    f.unboughtItem.id,
    extra.id,
  ]);
  const second = await f.api(
    c.shopBuy,
    "POST",
    `/shop/items/${extra.id}/buy`,
    f.member.auth,
    {},
    201,
  );
  await f.fund(f.other.id);
  const third = await f.api(
    c.shopBuy,
    "POST",
    `/shop/items/${f.item.id}/buy`,
    f.other.auth,
    {},
    201,
  );
  const fourth = await f.api(
    c.shopBuy,
    "POST",
    `/shop/items/${f.item.id}/buy`,
    f.member.auth,
    {},
    201,
  );
  await f.api(c.shopBuy, "POST", `/shop/items/${excluded.id}/buy`, f.other.auth, {}, 201);
  await pages(f, c.shopInventory, "/shop/inventory?state=unused", f.member.auth, [
    second.inventory!.id,
    f.inventory.id,
  ]);
  await pages(
    f,
    c.shopInventory,
    `/shop/inventory?state=unused&userId=${f.member.id}`,
    f.admin.auth,
    [second.inventory!.id, f.inventory.id],
  );
  await pages(f, c.shopPurchases, `/shop/purchases?buyerId=${f.member.id}`, f.admin.auth, [
    fourth.purchase.id,
    second.purchase.id,
    f.bought.purchase.id,
  ]);
  await pages(f, c.shopPurchases, `/shop/purchases?itemId=${f.item.id}`, f.admin.auth, [
    fourth.purchase.id,
    third.purchase.id,
    f.bought.purchase.id,
  ]);
  await pages(
    f,
    c.shopPurchases,
    `/shop/purchases?buyerId=${f.member.id}&itemId=${f.item.id}`,
    f.admin.auth,
    [fourth.purchase.id, f.bought.purchase.id],
  );
  await error(f.send("GET", "/shop/purchases?itemId=1.5", f.admin.auth), 400, "validation", [
    "itemId",
  ]);
  await error(
    f.send("GET", "/shop/inventory?state=unused&userId=1e0", f.admin.auth),
    400,
    "validation",
    ["userId"],
  );
});

test("all four inventory state query values select only entries in that state", async () => {
  const f = await setup();
  const category = await f.category();
  const active = await f.item(category.id, { price: 0 });
  const temporary = await f.item(category.id, { price: 0, durationSeconds: 60 });
  const unused = await f.item(category.id, { price: 0, isConsumable: true });
  const used = await f.item(category.id, { price: 0, isConsumable: true });
  const held = new Map<string, number>();
  for (const [state, item] of [
    ["active", active],
    ["expired", temporary],
    ["unused", unused],
    ["used", used],
  ] as const) {
    const bought = await f.api(
      c.shopBuy,
      "POST",
      `/shop/items/${item.id}/buy`,
      f.member.auth,
      {},
      201,
    );
    held.set(state, bought.inventory!.id);
    if (state === "used")
      await f.api(
        c.shopUse,
        "POST",
        `/shop/inventory/${bought.inventory!.id}/use`,
        f.member.auth,
        {},
      );
  }
  registerShopJobs(f.ctx);
  f.ctx.clock.advance(60_001);
  enqueueJob(f.ctx, "shop.expire", {});
  await runDueJobs(f.ctx);
  for (const [state, id] of held) {
    const own = await f.api(
      c.shopInventory,
      "GET",
      `/shop/inventory?state=${state}`,
      f.member.auth,
    );
    expect(own).toMatchObject({ items: [{ id, userId: f.member.id, state }], nextCursor: null });
    const admin = await f.api(
      c.shopInventory,
      "GET",
      `/shop/inventory?state=${state}&userId=${f.member.id}&limit=1`,
      f.admin.auth,
    );
    expect(admin).toEqual(own);
    expect(
      await f.api(c.shopInventory, "GET", `/shop/inventory?state=${state}`, f.other.auth),
    ).toEqual({ items: [], nextCursor: null });
  }
  await error(f.send("GET", "/shop/inventory", f.member.auth), 400, "validation", ["state"]);
});

for (const mode of ["cookie", "key"] as const) {
  describe(`economy conflicts with ${mode} authentication`, () => {
    for (const scenario of ["insufficient credits", "sold out", "already owned"] as const) {
      test(`shop.buy: ${scenario} returns 409 without changing balance, stock, inventory or purchases`, async () => {
        const f = await setup(mode);
        const category = await f.category();
        const item = await f.item(category.id, { stock: scenario === "sold out" ? 0 : 3 });
        if (scenario !== "insufficient credits") await f.fund();
        if (scenario === "already owned")
          await f.api(c.shopBuy, "POST", `/shop/items/${item.id}/buy`, f.member.auth, {}, 201);
        const snapshot = async () => ({
          credits: await f.api(c.creditsHistory, "GET", "/credits", f.member.auth),
          item: await f.api(c.shopItemsGet, "GET", `/shop/items/${item.id}`, f.member.auth),
          inventory: await f.api(
            c.shopInventory,
            "GET",
            "/shop/inventory?state=active",
            f.member.auth,
          ),
          purchases: await f.api(c.shopPurchases, "GET", "/shop/purchases", f.admin.auth),
        });
        const before = await snapshot();
        await error(
          f.send("POST", `/shop/items/${item.id}/buy`, f.member.auth, {}),
          409,
          "conflict",
        );
        expect(await snapshot()).toEqual(before);
      });
    }
    test("awards.grant rejects a non-stackable award already held, and awards.delete preserves grant history", async () => {
      const f = await setup(mode);
      const award = await f.award({ xp: 9, credits: 5 });
      const grant = await f.api(
        c.awardsGrant,
        "POST",
        `/users/${f.member.id}/awards`,
        f.admin.auth,
        { awardId: award.id },
        201,
      );
      await error(
        f.send("POST", `/users/${f.member.id}/awards`, f.admin.auth, { awardId: award.id }),
        409,
        "conflict",
      );
      expect(await f.api(c.creditsHistory, "GET", "/credits", f.member.auth)).toMatchObject({
        balance: 5,
        items: [{ amount: 5 }],
      });
      expect(await f.api(c.awardsMember, "GET", `/users/${f.member.id}/awards`, {})).toMatchObject({
        xp: 9,
        items: [{ count: 1 }],
      });
      await error(f.send("DELETE", `/awards/${award.id}`, f.admin.auth), 409, "conflict");
      await f.api(
        c.awardsRevoke,
        "DELETE",
        `/award-grants/${grant.id}?reason=Returned%20award`,
        f.admin.auth,
      );
      await error(f.send("DELETE", `/awards/${award.id}`, f.admin.auth), 409, "conflict");
      await error(f.send("DELETE", `/award-grants/${grant.id}`, f.admin.auth), 404, "not_found");
      const history = await f.api(c.creditsHistory, "GET", "/credits", f.member.auth);
      expect(history).toMatchObject({
        balance: 0,
        items: [{ amount: -5, reason: "Returned award" }, { amount: 5 }],
      });
      expect(await f.api(c.awardsMember, "GET", `/users/${f.member.id}/awards`, {})).toEqual({
        xp: 0,
        items: [],
      });
    });
    test("shopItems.delete and shopItems.update preserve bought items, and categories cannot delete their items", async () => {
      const f = await fixture(mode);
      await error(f.send("DELETE", `/shop/items/${f.item.id}`, f.admin.auth), 409, "conflict");
      await error(
        f.send("PATCH", `/shop/items/${f.item.id}`, f.admin.auth, { effect: { type: "bump" } }),
        409,
        "conflict",
      );
      await error(
        f.send("DELETE", `/shop/categories/${f.category.id}`, f.admin.auth),
        409,
        "conflict",
      );
      await f.api(c.shopUse, "POST", `/shop/inventory/${f.inventory.id}/use`, f.member.auth, {});
      await error(
        f.send("POST", `/shop/inventory/${f.inventory.id}/use`, f.member.auth, {}),
        409,
        "conflict",
      );
      await error(f.send("DELETE", `/shop/items/${f.item.id}`, f.admin.auth), 409, "conflict");
    });
  });
}

test("inactive awards and catalog entries are hidden from guests and members but visible to admins", async () => {
  const f = await setup("key");
  const award = await f.award({ isActive: false });
  const category = await f.category({ isActive: false });
  const item = await f.item(category.id, { price: 0 });
  const activeCategory = await f.category({ name: "Active" });
  const inactiveItem = await f.item(activeCategory.id, { isActive: false });
  for (const auth of [{}, f.member.auth]) {
    expect(await f.api(c.awardsList, "GET", "/awards", auth)).toEqual({ items: [] });
    await error(f.send("GET", `/awards/${award.id}`, auth), 404, "not_found");
    await error(f.send("GET", `/awards/${award.id}/holders`, auth), 404, "not_found");
    expect(await f.api(c.shopCategoriesList, "GET", "/shop/categories", auth)).toEqual({
      items: [activeCategory],
    });
    for (const id of [item.id, inactiveItem.id])
      await error(f.send("GET", `/shop/items/${id}`, auth), 404, "not_found");
    const listed = await f.api(
      c.shopItemsList,
      "GET",
      `/shop/categories/${activeCategory.id}/items`,
      auth,
    );
    expect(listed).toEqual({ items: [], nextCursor: null });
  }
  expect(await f.api(c.awardsGet, "GET", `/awards/${award.id}`, f.admin.auth)).toEqual(award);
  expect(await f.api(c.shopItemsGet, "GET", `/shop/items/${item.id}`, f.admin.auth)).toEqual(item);
  expect(
    await f.api(c.shopItemsGet, "GET", `/shop/items/${inactiveItem.id}`, f.admin.auth),
  ).toEqual(inactiveItem);
  expect(await f.api(c.shopCategoriesList, "GET", "/shop/categories", f.admin.auth)).toEqual({
    items: [category, activeCategory],
  });
  expect(
    await f.api(c.shopItemsList, "GET", `/shop/categories/${category.id}/items`, f.admin.auth),
  ).toEqual({ items: [item], nextCursor: null });
});

test("private profiles and another member's inventory cannot be accessed through awards or shop use", async () => {
  const f = await fixture("key");
  f.ctx.sqlite
    .prepare("UPDATE users SET profile_view_privacy = 'self' WHERE id = ?1")
    .run(f.member.id);
  for (const auth of [{}, f.other.auth]) {
    await error(f.send("GET", `/users/${f.member.id}/awards`, auth), 404, "not_found");
    await error(f.send("GET", `/users/${f.member.id}/award-grants`, auth), 404, "not_found");
  }
  await error(
    f.send("POST", `/shop/inventory/${f.inventory.id}/use`, f.other.auth, {}),
    404,
    "not_found",
  );
  expect(
    await f.api(c.shopInventory, "GET", "/shop/inventory?state=unused", f.member.auth),
  ).toMatchObject({ items: [{ id: f.inventory.id, quantity: 1 }] });
  expect(
    await f.api(c.awardsMember, "GET", `/users/${f.member.id}/awards`, f.member.auth),
  ).toMatchObject({ xp: 7 });
});

test("gifts require shop.gift, a giftable item, and an existing recipient", async () => {
  const f = await fixture();
  await error(
    f.send("POST", `/shop/items/${f.item.id}/buy`, f.member.auth, { recipientId: missingId }),
    404,
    "not_found",
  );
  await error(
    f.send("POST", `/shop/items/${f.unboughtItem.id}/buy`, f.member.auth, {
      recipientId: f.other.id,
    }),
    403,
    "forbidden",
  );
  deny(f.ctx, f.member.id, "shop.gift");
  await error(
    f.send("POST", `/shop/items/${f.item.id}/buy`, f.member.auth, { recipientId: f.other.id }),
    403,
    "forbidden",
  );
  expect(await f.api(c.shopInventory, "GET", "/shop/inventory?state=unused", f.other.auth)).toEqual(
    { items: [], nextCursor: null },
  );
});

test("selling permission items requires admin.permissions as well as admin.shop", async () => {
  const f = await setup("key");
  const category = await f.category();
  f.ctx.sqlite
    .prepare(
      "INSERT INTO permission_entries (user_id, permission_id, value) SELECT ?1, id, 1 FROM permission_definitions WHERE key = 'admin.shop'",
    )
    .run(f.member.id);
  const item = await f.item(category.id, {
    effect: { type: "permission", permission: "credits.viewAny" },
  });
  await error(
    f.send("POST", "/shop/items", f.member.auth, {
      categoryId: category.id,
      name: "Privilege",
      price: 1,
      effect: item.effect,
    }),
    403,
    "forbidden",
  );
  await error(
    f.send("PATCH", `/shop/items/${item.id}`, f.member.auth, { price: 2 }),
    403,
    "forbidden",
  );
});

test("shopItems.delete: admin.shop may delete a never-bought permission item without admin.permissions", async () => {
  const f = await setup("key");
  const category = await f.category();
  const ordinary = await f.item(category.id);
  const permission = await f.item(category.id, {
    effect: { type: "permission", permission: "credits.viewAny" },
  });
  f.ctx.sqlite
    .prepare(
      "INSERT INTO permission_entries (user_id, permission_id, value) SELECT ?1, id, 1 FROM permission_definitions WHERE key = 'admin.shop'",
    )
    .run(f.member.id);
  const me = await f.api(c.authMe, "GET", "/me", f.member.auth);
  expect(me.resolvedPermissions["admin.shop"]).toBe(true);
  expect(me.resolvedPermissions["admin.permissions"]).toBe(false);
  await f.api(c.shopItemsDelete, "DELETE", `/shop/items/${ordinary.id}`, f.member.auth);
  await f.api(c.shopItemsDelete, "DELETE", `/shop/items/${permission.id}`, f.member.auth);
  await error(f.send("GET", `/shop/items/${permission.id}`, f.admin.auth), 404, "not_found");
});

test("award grants and item updates report missing referenced users and categories", async () => {
  const f = await fixture();
  await error(
    f.send("POST", `/users/${missingId}/awards`, f.admin.auth, { awardId: f.award.id }),
    404,
    "not_found",
  );
  await error(
    f.send("PATCH", `/shop/items/${f.item.id}`, f.admin.auth, { categoryId: missingId }),
    404,
    "not_found",
  );
});

test("path IDs take precedence over body IDs and DELETE carries its reason from the query", async () => {
  const f = await fixture();
  const adjustment = await f.api(
    c.creditsAdjust,
    "POST",
    `/users/${f.member.id}/credits`,
    f.admin.auth,
    { userId: f.other.id, amount: -100, reason: "Debit" },
    201,
  );
  expect(adjustment).toMatchObject({ userId: f.member.id, balanceAfter: -10 });
  expect(await f.api(c.creditsHistory, "GET", "/credits", f.other.auth)).toEqual({
    balance: 0,
    items: [],
    nextCursor: null,
  });
  await f.api(c.creditRulesUpdate, "PATCH", `/credit-rules/${f.rule.id}`, f.admin.auth, {
    ruleId: missingId,
    amount: 8,
  });
  expect(await f.api(c.creditRulesList, "GET", "/credit-rules", f.admin.auth)).toMatchObject({
    items: [{ id: f.rule.id, amount: 8 }],
  });
  await error(
    f.send("DELETE", `/award-grants/${f.grant.id}?reason=${"x".repeat(501)}`, f.admin.auth),
    400,
    "validation",
    ["reason"],
  );
});

test("fixed economy paths dispatch criteria, award sweep, global ledger and credit rebuild", async () => {
  const f = await setup("key");
  const criteria = await f.api(c.awardsCriteria, "GET", "/awards/criteria", f.admin.auth);
  expect(criteria.items.some((criterion) => criterion.id === "credits_at_least")).toBe(true);
  expect(await f.api(c.creditsLedger, "GET", "/credits/ledger", f.admin.auth)).toEqual({
    balance: null,
    items: [],
    nextCursor: null,
  });
  for (const [contract, path, job] of [
    [c.awardsRun, "/awards/run", "awards.sweep"],
    [c.creditsRecalculate, "/credits/recalculate", "credits.recalculate"],
  ] as const) {
    expect(await f.api(contract, "POST", path, f.admin.auth, {}, 201)).toEqual({ queued: true });
    expect(await f.api(contract, "POST", path, f.admin.auth, {}, 201)).toEqual({ queued: false });
    expect(
      f.ctx.sqlite
        .prepare<{ type: string }, [string]>("SELECT type FROM jobs WHERE type = ?1")
        .all(job),
    ).toEqual([{ type: job }]);
  }
});

for (const mode of ["cookie", "key"] as const) {
  test(`economy end-to-end with ${mode}: posting earns credits, an award funds a permission purchase, and a gift reaches its recipient`, async () => {
    const f = await setup(mode);
    registerCreditRuleJobs(f.ctx);
    const forum = await f.api(
      c.nodesCreate,
      "POST",
      "/nodes",
      f.admin.auth,
      { parentId: null, type: "forum", title: "General" },
      201,
    );
    await f.api(
      c.creditRulesCreate,
      "POST",
      "/credit-rules",
      f.admin.auth,
      { title: "Reward replies", trigger: "reply_posted", amount: 30, nodeIds: [forum.id] },
      201,
    );
    const award = await f.award({ xp: 12, credits: 20 });
    const category = await f.category({ name: "Privileges" });
    const privilege = await f.item(category.id, {
      price: 40,
      isGiftable: true,
      effect: { type: "permission", permission: "credits.viewAny" },
    });
    const gift = await f.item(category.id, { name: "Gift frame", price: 10, isGiftable: true });
    const before = await f.api(c.authMe, "GET", "/me", f.member.auth);
    expect(before.resolvedPermissions["credits.viewAny"]).toBe(false);
    const thread = await f.api(
      c.threadsCreate,
      "POST",
      `/nodes/${forum.id}/threads`,
      f.other.auth,
      { title: "Welcome", body: "Introduce yourself" },
      201,
    );
    const reply = await f.api(
      c.postsCreate,
      "POST",
      `/threads/${thread.thread.id}/posts`,
      f.member.auth,
      { body: "A helpful reply" },
      201,
    );
    expect(await f.api(c.creditsHistory, "GET", "/credits", f.member.auth)).toEqual({
      balance: 0,
      items: [],
      nextCursor: null,
    });
    await dispatchEvents(f.ctx);
    const earned = await f.api(c.creditsHistory, "GET", "/credits", f.member.auth);
    expect(earned).toMatchObject({
      balance: 30,
      items: [{ amount: 30, type: "event", actor: null }],
    });
    expect(reply.author).toMatchObject({ kind: "member", id: f.member.id });
    await dispatchEvents(f.ctx);
    expect(await f.api(c.creditsHistory, "GET", "/credits", f.member.auth)).toEqual(earned);
    const grant = await f.api(
      c.awardsGrant,
      "POST",
      `/users/${f.member.id}/awards`,
      f.admin.auth,
      { awardId: award.id, reason: "Helpful member" },
      201,
    );
    expect(grant).toMatchObject({
      user: { id: f.member.id },
      award: { xp: 12, credits: 20 },
      grantedBy: { id: f.admin.id },
    });
    expect(await f.api(c.creditsHistory, "GET", "/credits", f.member.auth)).toMatchObject({
      balance: 50,
    });
    const bought = await f.api(
      c.shopBuy,
      "POST",
      `/shop/items/${privilege.id}/buy`,
      f.member.auth,
      {},
      201,
    );
    expect(bought).toMatchObject({
      balance: 10,
      inventory: { state: "active", userId: f.member.id, item: { id: privilege.id } },
    });
    const after = await f.api(c.authMe, "GET", "/me", f.member.auth);
    expect(after.resolvedPermissions["credits.viewAny"]).toBe(true);
    expect(
      await f.api(c.creditsLedger, "GET", `/credits/ledger?userId=${f.other.id}`, f.member.auth),
    ).toEqual({ balance: 0, items: [], nextCursor: null });
    const sent = await f.api(
      c.shopBuy,
      "POST",
      `/shop/items/${gift.id}/buy`,
      f.member.auth,
      { recipientId: f.other.id },
      201,
    );
    expect(sent).toMatchObject({
      balance: 0,
      inventory: null,
      purchase: { buyer: { id: f.member.id }, recipient: { id: f.other.id }, price: 10 },
    });
    expect(
      await f.api(c.shopInventory, "GET", "/shop/inventory?state=active", f.other.auth),
    ).toMatchObject({ items: [{ userId: f.other.id, item: { id: gift.id } }], nextCursor: null });
    expect(
      await f.api(c.shopInventory, "GET", "/shop/inventory?state=active", f.member.auth),
    ).toMatchObject({ items: [{ item: { id: privilege.id } }], nextCursor: null });
    expect(await f.api(c.creditsHistory, "GET", "/credits", f.other.auth)).toEqual({
      balance: 0,
      items: [],
      nextCursor: null,
    });
    expect(await f.api(c.creditsHistory, "GET", "/credits", f.member.auth)).toMatchObject({
      balance: 0,
      items: [{ amount: -10 }, { amount: -40 }, { amount: 20 }, { amount: 30 }],
    });
  });
}
