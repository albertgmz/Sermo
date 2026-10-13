import { afterEach, describe, expect, test } from "bun:test";
import {
  createTestContext,
  insertNode,
  insertUser,
  tokenActor,
  userActor,
} from "@sermo/core/testing";
import { type Actor, GUEST } from "../../actor";
import { closeContext, invalidate } from "../../context";
import { writeTx } from "../../db/tx";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from "../../errors";
import { type AnyOperation, execute } from "../../operation";
import { can, memberStanding } from "../../permissions";
import { moveCredits } from "../../shared/credits";
import { insertCatalogImage, insertPaletteColor } from "../appearance/catalog-fixtures";
import { enqueueJob, runDueJobs } from "../jobs/queue";
import { expireShopBatch } from "./expiry";
import { operations, registerShopJobs } from "./index";

const contexts: ReturnType<typeof createTestContext>[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});
function fixture() {
  const ctx = createTestContext();
  contexts.push(ctx);
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const member = insertUser(ctx);
  const recipient = insertUser(ctx);
  const frameId = insertCatalogImage(ctx, "frame");
  const actor = userActor(member);
  const call = (name: string, input: unknown = {}, as: Actor = actor) => {
    const op: AnyOperation = operations.find((op) => op.name === name)!;
    return execute(ctx, op, as, input);
  };
  const fund = (id = member.id, amount = 100) =>
    writeTx(ctx, () => moveCredits(ctx, [{ userId: id, amount, type: "adjustment" }]));
  const create = async (fields: Record<string, unknown> = {}) => {
    const category = await call("shopCategories.create", { name: "Catalog" }, admin);
    return call(
      "shopItems.create",
      {
        categoryId: category.id,
        name: "Frame",
        price: 10,
        effect: { type: "frame", frameId },
        ...fields,
      },
      admin,
    );
  };
  const expire = async () => {
    registerShopJobs(ctx);
    enqueueJob(ctx, "shop.expire", {}, { uniqueKey: "shop.expire" });
    await runDueJobs(ctx);
    expect(
      ctx.sqlite
        .prepare("SELECT id FROM jobs WHERE type = 'shop.expire' AND status != 'done'")
        .all(),
    ).toEqual([]);
  };
  return { ctx, call, create, fund, expire, actor, admin, member, recipient, frameId };
}
function deny(
  ctx: ReturnType<typeof createTestContext>,
  userId: number,
  permission: string,
  value = -1,
) {
  ctx.sqlite
    .prepare(
      "INSERT INTO permission_entries (group_id, user_id, node_id, permission_id, value) SELECT 0, ?1, 0, id, ?2 FROM permission_definitions WHERE key = ?3",
    )
    .run(userId, value, permission);
}

describe("shop purchases and inventory", () => {
  describe("hidden catalog entries", () => {
    const cases = [
      ["inactive item", { isActive: false }, false],
      ["active item in an inactive category", {}, true],
    ] as const;
    for (const [label, fields, hideCategory] of cases) {
      const setup = async (isGift: boolean) => {
        const f = fixture();
        f.fund();
        const item = await f.create({ ...fields, ...(isGift ? { isGiftable: false } : {}) });
        if (hideCategory)
          await f.call(
            "shopCategories.update",
            { categoryId: item.categoryId, isActive: false },
            f.admin,
          );
        return { ...f, item };
      };
      const snapshot = (ctx: ReturnType<typeof createTestContext>) => [
        ctx.sqlite.prepare("SELECT * FROM shop_inventory").all(),
        ctx.sqlite.prepare("SELECT * FROM shop_purchases").all(),
        ctx.sqlite.prepare("SELECT * FROM credit_transactions").all(),
        ctx.sqlite.prepare("SELECT credits FROM users").all(),
        ctx.sqlite.prepare("SELECT stock FROM shop_items").all(),
      ];
      test(`a member buying an ${label} gets not found, like a missing item`, async () => {
        const { ctx, call, item } = await setup(false);
        const before = snapshot(ctx);
        await expect(call("shop.buy", { itemId: item.id })).rejects.toBeInstanceOf(NotFoundError);
        await expect(call("shop.buy", { itemId: 9999 })).rejects.toBeInstanceOf(NotFoundError);
        expect(snapshot(ctx)).toEqual(before);
      });
      test(`a member gifting a non-giftable ${label} gets not found, not forbidden`, async () => {
        const { ctx, call, item, recipient } = await setup(true);
        const before = snapshot(ctx);
        await expect(
          call("shop.buy", { itemId: item.id, recipientId: recipient.id }),
        ).rejects.toBeInstanceOf(NotFoundError);
        expect(snapshot(ctx)).toEqual(before);
      });
      test(`a shop administrator buying an ${label} gets a conflict`, async () => {
        const { ctx, call, item, admin, fund } = await setup(false);
        if (admin.kind !== "user") throw new Error("expected a user actor");
        fund(admin.userId);
        const before = snapshot(ctx);
        await expect(call("shop.buy", { itemId: item.id }, admin)).rejects.toBeInstanceOf(
          ConflictError,
        );
        expect(snapshot(ctx)).toEqual(before);
      });
    }
  });

  test("reordering an unchanged purchased effect is not a change of terms", async () => {
    const { ctx, call, create, fund, admin, frameId } = fixture();
    fund();
    const item = await create();
    await call("shop.buy", { itemId: item.id });
    ctx.sqlite
      .prepare("UPDATE shop_items SET effect = ?1 WHERE id = ?2")
      .run(JSON.stringify({ frameId, type: "frame" }), item.id);
    expect(
      await call(
        "shopItems.update",
        { itemId: item.id, effect: { type: "frame", frameId }, price: 20 },
        admin,
      ),
    ).toMatchObject({ price: 20 });
  });
  test("expiry drains more than one bounded batch and yields without touching future or permanent rows", async () => {
    const { ctx, call, create, expire } = fixture();
    const temporary = await create({ price: 0, durationSeconds: 60 });
    for (let n = 0; n < 25; n++)
      await call("shop.buy", { itemId: temporary.id }, userActor(insertUser(ctx)));
    ctx.clock.advance(60_000);
    const future = await call("shop.buy", { itemId: temporary.id });
    const permanent = await create({ price: 0 });
    await call("shop.buy", { itemId: permanent.id });
    expect(expireShopBatch(ctx)).toBeLessThanOrEqual(10);
    expect(
      ctx.sqlite
        .prepare("SELECT id FROM shop_inventory WHERE state = 'active' AND expires_at <= ?1")
        .all(ctx.now()).length,
    ).toBeGreaterThan(0);
    let yielded = false;
    setImmediate(() => {
      yielded = true;
    });
    await expire();
    expect(yielded).toBe(true);
    expect(
      ctx.sqlite.prepare("SELECT id FROM shop_inventory WHERE state = 'expired'").all(),
    ).toHaveLength(25);
    expect(
      (await call("shop.inventory", { state: "active" })).items.map(
        (row: { id: number }) => row.id,
      ),
    ).toContain(future.inventory.id);
    expect((await call("shop.inventory", { state: "active" })).items).toHaveLength(2);
    expect(expireShopBatch(ctx)).toBe(0);
  });
  test("charges and delivers atomically, logs its source, and protects bought item terms", async () => {
    const { ctx, call, create, fund, admin, member } = fixture();
    fund();
    const item = await create({ stock: 2 });
    const bought = await call("shop.buy", { itemId: item.id });
    expect(bought).toMatchObject({
      balance: 90,
      inventory: { state: "active", quantity: 1, expiresAt: null },
      purchase: { buyer: { id: member.id }, recipient: { id: member.id }, price: 10 },
    });
    expect(
      ctx.sqlite
        .prepare(
          "SELECT amount, source_type, source_id, actor_id FROM credit_transactions WHERE type = 'purchase'",
        )
        .get(),
    ).toEqual({
      amount: -10,
      source_type: "shop_purchase",
      source_id: bought.purchase.id,
      actor_id: member.id,
    });
    expect((await call("shopItems.get", { itemId: item.id })).stock).toBe(1);
    await expect(call("shop.buy", { itemId: item.id })).rejects.toBeInstanceOf(ConflictError);
    for (const change of [
      { effect: { type: "bump" } },
      { isConsumable: true },
      { durationSeconds: 60 },
    ])
      await expect(
        call("shopItems.update", { itemId: item.id, ...change }, admin),
      ).rejects.toBeInstanceOf(ConflictError);
    await expect(call("shopItems.delete", { itemId: item.id }, admin)).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(await call("shopItems.update", { itemId: item.id, price: 20 }, admin)).toMatchObject({
      price: 20,
    });
    expect((await call("shop.inventory", { state: "active" })).items).toHaveLength(1);
    const event = ctx.sqlite
      .prepare<{ payload: string }, []>(
        "SELECT payload FROM domain_events WHERE type = 'shop.purchased'",
      )
      .get()!;
    expect(JSON.parse(event.payload)).toEqual({
      itemId: item.id,
      buyerId: member.id,
      recipientId: member.id,
      quantity: 1,
      price: 10,
      inventoryId: bought.inventory.id,
    });
  });

  for (const reason of ["funds", "stock", "item", "category"])
    test(`rolls back completely for unavailable ${reason}`, async () => {
      const { ctx, call, create, admin, fund } = fixture();
      if (reason !== "funds") fund();
      const item = await create({ stock: reason === "stock" ? 0 : 2, isActive: reason !== "item" });
      if (reason === "category")
        await call(
          "shopCategories.update",
          { categoryId: item.categoryId, isActive: false },
          admin,
        );
      const before = ctx.sqlite.prepare("SELECT credits, shop_purchase_count FROM users").all();
      const events = ctx.sqlite.prepare("SELECT * FROM domain_events").all();
      const ledger = ctx.sqlite.prepare("SELECT * FROM credit_transactions").all();
      await expect(call("shop.buy", { itemId: item.id })).rejects.toBeInstanceOf(
        reason === "item" || reason === "category" ? NotFoundError : ConflictError,
      );
      expect(ctx.sqlite.prepare("SELECT * FROM shop_inventory").all()).toEqual([]);
      expect(ctx.sqlite.prepare("SELECT * FROM shop_purchases").all()).toEqual([]);
      expect(ctx.sqlite.prepare("SELECT credits, shop_purchase_count FROM users").all()).toEqual(
        before,
      );
      expect(ctx.sqlite.prepare("SELECT * FROM credit_transactions").all()).toEqual(ledger);
      expect(ctx.sqlite.prepare("SELECT * FROM domain_events").all()).toEqual(events);
      expect((await call("shopItems.get", { itemId: item.id }, admin)).stock).toBe(item.stock);
    });

  test("free items skip the ledger; nonconsumables reject multiple units", async () => {
    const { ctx, call, create, member } = fixture();
    const item = await create({ price: 0 });
    await expect(call("shop.buy", { itemId: item.id, quantity: 2 })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await call("shop.buy", { itemId: item.id, recipientId: member.id })).toMatchObject({
      balance: 0,
      inventory: { userId: member.id },
    });
    expect(ctx.sqlite.prepare("SELECT * FROM credit_transactions").all()).toEqual([]);
  });

  test("stock 1 with two buyers and one unit of balance with two purchases allow one success", async () => {
    const { ctx, call, create, fund, recipient } = fixture();
    fund(undefined, 10);
    fund(recipient.id, 10);
    const item = await create({ stock: 1, isConsumable: true });
    const stock = await Promise.allSettled([
      call("shop.buy", { itemId: item.id }),
      call("shop.buy", { itemId: item.id }, userActor(recipient)),
    ]);
    expect(stock.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(
      (stock.find((x) => x.status === "rejected") as PromiseRejectedResult).reason,
    ).toBeInstanceOf(ConflictError);
    const other = await create({ isConsumable: true });
    const balance = await Promise.allSettled([
      call("shop.buy", { itemId: other.id }, userActor(recipient)),
      call("shop.buy", { itemId: other.id }, userActor(recipient)),
    ]);
    expect(balance.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(
      (balance.find((x) => x.status === "rejected") as PromiseRejectedResult).reason,
    ).toBeInstanceOf(ConflictError);
    expect(ctx.sqlite.prepare("SELECT id FROM users WHERE credits < 0").all()).toEqual([]);
  });

  test("gifts charge the buyer, deliver to recipient, and enforce gift restrictions", async () => {
    const { ctx, call, create, fund, admin, member, recipient } = fixture();
    fund();
    const item = await create({ isGiftable: true });
    expect(await call("shop.buy", { itemId: item.id, recipientId: recipient.id })).toMatchObject({
      balance: 90,
      inventory: null,
      purchase: { buyer: { id: member.id }, recipient: { id: recipient.id } },
    });
    expect((await call("shop.inventory", { state: "active" })).items).toEqual([]);
    expect(
      (await call("shop.inventory", { state: "active", userId: recipient.id }, admin)).items,
    ).toHaveLength(1);
    expect(
      ctx.sqlite.prepare("SELECT shop_purchase_count FROM users WHERE id = ?1").get(member.id),
    ).toEqual({ shop_purchase_count: 1 });
    expect(
      ctx.sqlite
        .prepare("SELECT credits, shop_purchase_count FROM users WHERE id = ?1")
        .get(recipient.id),
    ).toEqual({ credits: 0, shop_purchase_count: 0 });
    await expect(
      call("shop.buy", { itemId: item.id, recipientId: recipient.id }),
    ).rejects.toBeInstanceOf(ConflictError);
    const notGiftable = await create();
    await expect(
      call("shop.buy", { itemId: notGiftable.id, recipientId: recipient.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(call("shop.buy", { itemId: item.id, recipientId: 999999 })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    ctx.sqlite
      .prepare("INSERT INTO user_ignores (user_id, ignored_id, created_at) VALUES (?1, ?2, 0)")
      .run(recipient.id, member.id);
    const ignored = await create({ isGiftable: true });
    await expect(
      call("shop.buy", { itemId: ignored.id, recipientId: recipient.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      call("shop.buy", { itemId: ignored.id, recipientId: recipient.id }),
    ).rejects.not.toThrow(/ignor/i);
    ctx.sqlite.prepare("DELETE FROM user_ignores WHERE user_id = ?1").run(recipient.id);
    deny(ctx, member.id, "shop.gift");
    await expect(
      call("shop.buy", { itemId: ignored.id, recipientId: recipient.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(ctx.sqlite.prepare("SELECT id FROM shop_purchases").all()).toHaveLength(1);
  });

  test("staff ignore rows do not block gifts and token buyers act as their member", async () => {
    const { ctx, call, create, recipient, fund } = fixture();
    const staff = insertUser(ctx, { groupId: 3 });
    fund(staff.id);
    ctx.sqlite
      .prepare("INSERT INTO user_ignores (user_id, ignored_id, created_at) VALUES (?1, ?2, 0)")
      .run(recipient.id, staff.id);
    const item = await create({ isGiftable: true });
    expect(
      await call("shop.buy", { itemId: item.id, recipientId: recipient.id }, tokenActor(staff)),
    ).toMatchObject({ balance: 90, inventory: null });
  });

  test("permission purchases take effect immediately, expire, and renew", async () => {
    const { ctx, call, create, fund, expire, member } = fixture();
    fund();
    const item = await create({
      durationSeconds: 60,
      effect: { type: "permission", permission: "forum.viewDeleted" },
    });
    const node = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    expect(can(ctx, userActor(member), "forum.viewDeleted", { nodeId: node.id })).toBe(false);
    const first = await call("shop.buy", { itemId: item.id });
    expect(can(ctx, userActor(member), "forum.viewDeleted", { nodeId: node.id })).toBe(true);
    await expect(call("shop.use", { inventoryId: first.inventory.id })).rejects.toBeInstanceOf(
      ConflictError,
    );
    ctx.clock.advance(60_001);
    expect(can(ctx, userActor(member), "forum.viewDeleted", { nodeId: node.id })).toBe(true);
    await expire();
    await expire();
    expect(can(ctx, userActor(member), "forum.viewDeleted", { nodeId: node.id })).toBe(false);
    expect((await call("shop.inventory", { state: "expired" })).items).toHaveLength(1);
    const renewed = await call("shop.buy", { itemId: item.id });
    expect(renewed.inventory.id).toBe(first.inventory.id);
    expect(renewed.inventory.expiresAt).toBe(new Date(ctx.now() + 60_000).toISOString());
    expect(can(ctx, userActor(member), "forum.viewDeleted", { nodeId: node.id })).toBe(true);
  });

  test("an item whose row has lapsed but is not yet marked expired can be bought again at once", async () => {
    const { ctx, call, create, fund, member } = fixture();
    fund();
    const item = await create({
      durationSeconds: 60,
      effect: { type: "permission", permission: "forum.viewDeleted" },
    });
    const node = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    const first = await call("shop.buy", { itemId: item.id });
    // Still running: it is owned.
    ctx.clock.advance(59_000);
    await expect(call("shop.buy", { itemId: item.id })).rejects.toThrow(/already owned/);
    // Lapsed, and the job has not run: the row still says active.
    ctx.clock.advance(2_000);
    expect(
      ctx.sqlite
        .prepare<{ state: string }, [number]>("SELECT state FROM shop_inventory WHERE id = ?1")
        .get(first.inventory.id)!.state,
    ).toBe("active");
    const renewed = await call("shop.buy", { itemId: item.id });
    expect(renewed.inventory).toMatchObject({ id: first.inventory.id, state: "active" });
    expect(renewed.inventory.expiresAt).toBe(new Date(ctx.now() + 60_000).toISOString());
    expect(renewed.balance).toBe(80);
    expect(can(ctx, userActor(member), "forum.viewDeleted", { nodeId: node.id })).toBe(true);
    // The running purchase is owned again, and the job finds nothing left to expire.
    await expect(call("shop.buy", { itemId: item.id })).rejects.toThrow(/already owned/);
    expect(expireShopBatch(ctx)).toBe(0);
  });

  test("consumable permissions last until the last unit, then can be bought again", async () => {
    const { ctx, call, create, fund, member } = fixture();
    fund();
    const item = await create({
      isConsumable: true,
      effect: { type: "permission", permission: "profilePost.viewDeleted" },
    });
    const bought = await call("shop.buy", { itemId: item.id, quantity: 2 });
    expect(bought.inventory).toMatchObject({ state: "unused", quantity: 2 });
    expect(can(ctx, userActor(member), "profilePost.viewDeleted")).toBe(true);
    expect(await call("shop.use", { inventoryId: bought.inventory.id })).toMatchObject({
      state: "unused",
      quantity: 1,
    });
    expect(can(ctx, userActor(member), "profilePost.viewDeleted")).toBe(true);
    expect(await call("shop.use", { inventoryId: bought.inventory.id })).toMatchObject({
      state: "used",
      quantity: 0,
    });
    expect(can(ctx, userActor(member), "profilePost.viewDeleted")).toBe(false);
    await expect(call("shop.use", { inventoryId: bought.inventory.id })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect((await call("shop.buy", { itemId: item.id })).inventory).toMatchObject({
      id: bought.inventory.id,
      quantity: 1,
      state: "unused",
    });
    expect(can(ctx, userActor(member), "profilePost.viewDeleted")).toBe(true);
    const payloads = ctx.sqlite
      .prepare<{ payload: string }, []>(
        "SELECT payload FROM domain_events WHERE type = 'shop.item_used' ORDER BY id",
      )
      .all()
      .map((row) => JSON.parse(row.payload));
    expect(payloads.map((row) => row.quantityLeft)).toEqual([1, 0]);
  });

  test("purchased groups change combinations, preserve hand assignments, and emit membership changes", async () => {
    const { ctx, call, create, fund, expire, member, recipient } = fixture();
    fund();
    fund(recipient.id);
    const group = ctx.sqlite
      .prepare<{ id: number }, []>(
        "INSERT INTO groups (title, rank) VALUES ('Supporter', 30) RETURNING id",
      )
      .get()!;
    const item = await create({
      durationSeconds: 60,
      effect: { type: "group", groupId: group.id },
    });
    ctx.sqlite
      .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, ?2, 0)")
      .run(recipient.id, group.id);
    const bought = await call("shop.buy", { itemId: item.id });
    await call("shop.buy", { itemId: item.id }, userActor(recipient));
    expect(memberStanding(ctx, userActor(member)).displayGroupId).toBe(group.id);
    await expect(call("shop.use", { inventoryId: bought.inventory.id })).rejects.toBeInstanceOf(
      ConflictError,
    );
    ctx.clock.advance(60_001);
    await expire();
    expect(memberStanding(ctx, userActor(member)).displayGroupId).toBe(member.groupId);
    expect(memberStanding(ctx, userActor(recipient)).displayGroupId).toBe(group.id);
    const events = ctx.sqlite
      .prepare<{ target_id: number; payload: string }, []>(
        "SELECT target_id, payload FROM domain_events WHERE type = 'member.groups_changed' ORDER BY id",
      )
      .all();
    expect(events.map((e) => ({ user: e.target_id, ...JSON.parse(e.payload) }))).toEqual([
      { user: member.id, added: [group.id], removed: [], source: "shop" },
      { user: member.id, added: [], removed: [group.id], source: "shop" },
    ]);
  });

  test("a group acquiring admin.permissions rolls the entire purchase back", async () => {
    const { ctx, call, create, fund, member } = fixture();
    fund();
    const group = ctx.sqlite
      .prepare<{ id: number }, []>(
        "INSERT INTO groups (title, rank) VALUES ('Supporter', 30) RETURNING id",
      )
      .get()!;
    const item = await create({ stock: 1, effect: { type: "group", groupId: group.id } });
    ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (group_id, user_id, node_id, permission_id, value) SELECT ?1, 0, 0, id, 1 FROM permission_definitions WHERE key = 'admin.permissions'",
      )
      .run(group.id);
    await expect(call("shop.buy", { itemId: item.id })).rejects.toBeInstanceOf(ConflictError);
    expect(ctx.sqlite.prepare("SELECT * FROM shop_inventory").all()).toEqual([]);
    expect(ctx.sqlite.prepare("SELECT * FROM shop_purchases").all()).toEqual([]);
    expect(
      ctx.sqlite.prepare("SELECT * FROM credit_transactions WHERE type = 'purchase'").all(),
    ).toEqual([]);
    expect(
      ctx.sqlite
        .prepare("SELECT credits, shop_purchase_count FROM users WHERE id = ?1")
        .get(member.id),
    ).toEqual({ credits: 100, shop_purchase_count: 0 });
    expect((await call("shopItems.get", { itemId: item.id })).stock).toBe(1);
    expect(
      ctx.sqlite.prepare("SELECT * FROM domain_events WHERE type != 'credits.changed'").all(),
    ).toEqual([]);
  });

  test("buy, use, inventory and purchase log permissions, wrong owners and missing rows", async () => {
    const { ctx, call, create, fund, admin, member, recipient } = fixture();
    fund();
    const moderator = userActor(insertUser(ctx, { groupId: 3 }));
    const item = await create();
    const bought = await call("shop.buy", { itemId: item.id });
    for (const [name, input] of [
      ["shop.buy", { itemId: item.id }],
      ["shop.use", { inventoryId: bought.inventory.id }],
      ["shop.inventory", { state: "active" }],
      ["shop.purchases", {}],
    ] as const)
      await expect(call(name, input, GUEST)).rejects.toBeInstanceOf(UnauthenticatedError);
    for (const actor of [userActor(member), moderator]) {
      await expect(
        call("shop.inventory", { state: "active", userId: recipient.id }, actor),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(call("shop.purchases", {}, actor)).rejects.toBeInstanceOf(ForbiddenError);
      expect((await call("shop.inventory", { state: "active" }, actor)).nextCursor).toBeNull();
    }
    for (const actor of [userActor(recipient), moderator, admin])
      await expect(
        call("shop.use", { inventoryId: bought.inventory.id }, actor),
      ).rejects.toBeInstanceOf(NotFoundError);
    await expect(call("shop.buy", { itemId: 999999 })).rejects.toBeInstanceOf(NotFoundError);
    await expect(call("shop.use", { inventoryId: 999999 })).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      call("shop.inventory", { state: "active", userId: 999999 }, admin),
    ).rejects.toBeInstanceOf(NotFoundError);
    for (const actor of [moderator, admin]) {
      const free = await create({
        price: 0,
        isConsumable: true,
        effect: { type: "permission", permission: "profile.signature" },
      });
      const own = await call("shop.buy", { itemId: free.id }, actor);
      expect(await call("shop.use", { inventoryId: own.inventory.id }, actor)).toMatchObject({
        quantity: 0,
        state: "used",
      });
    }
    deny(ctx, member.id, "shop.buy");
    await expect(call("shop.buy", { itemId: item.id })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(call("shop.use", { inventoryId: bought.inventory.id })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  test("inventory keysets resolve timestamp ties and purchases support every filter", async () => {
    const { ctx, call, create, fund, admin, member, recipient } = fixture();
    fund();
    fund(recipient.id);
    const first = await create({ isConsumable: true });
    const second = await create({ isConsumable: true });
    await call("shop.buy", { itemId: first.id });
    await call("shop.buy", { itemId: second.id });
    const page = await call("shop.inventory", { state: "unused", limit: 1 });
    expect(page.items[0].item.id).toBe(second.id);
    const next = await call("shop.inventory", {
      state: "unused",
      cursor: page.nextCursor,
      limit: 1,
    });
    expect(next.items[0].item.id).toBe(first.id);
    expect(next.nextCursor).toBeNull();
    ctx.clock.advance(1);
    await call("shop.buy", { itemId: first.id });
    expect((await call("shop.inventory", { state: "unused" })).items[0].item.id).toBe(first.id);
    await call("shop.buy", { itemId: second.id }, userActor(recipient));
    const all = (await call("shop.purchases", {}, admin)).items;
    for (const filters of [
      {},
      { buyerId: member.id },
      { itemId: second.id },
      { buyerId: member.id, itemId: first.id },
    ]) {
      const expected = all
        .filter(
          (p: { buyer: { id: number }; item: { id: number } }) =>
            (!filters.buyerId || p.buyer.id === filters.buyerId) &&
            (!filters.itemId || p.item.id === filters.itemId),
        )
        .map((p: { id: number }) => p.id);
      const found: number[] = [];
      let cursor: string | undefined;
      do {
        const page = await call("shop.purchases", { ...filters, limit: 1, cursor }, admin);
        found.push(...page.items.map((p: { id: number }) => p.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      expect(found).toEqual(expected);
    }
    await expect(
      call("shop.inventory", { state: "unused", cursor: "invalid" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(call("shop.purchases", { cursor: "invalid" }, admin)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("thread effects require a visible owned thread in a viewable node", async () => {
    const { ctx, call, create, fund, member, recipient } = fixture();
    fund();
    const node = insertNode(ctx, {});
    const hidden = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (group_id, user_id, node_id, permission_id, value) SELECT 0, ?1, ?2, id, -1 FROM permission_definitions WHERE key = 'node.view'",
      )
      .run(member.id, hidden.id);
    const thread = (userId: number, nodeId = node.id, state = "visible") =>
      ctx.sqlite
        .prepare<{ id: number }, [number, number, string]>(
          "INSERT INTO threads (node_id, user_id, title, state, created_at, last_post_at, last_poster_id) VALUES (?1, ?2, 'A thread', ?3, 0, 0, ?2) RETURNING id",
        )
        .get(nodeId, userId, state)!.id;
    const visible = thread(member.id);
    const wrongOwner = thread(recipient.id);
    const badIds = [
      999999,
      wrongOwner,
      thread(member.id, node.id, "deleted"),
      thread(member.id, node.id, "moderated"),
      thread(member.id, hidden.id),
    ];
    const cover = insertCatalogImage(ctx, "thread_cover");
    for (const effect of [
      { type: "threadCover", coverId: cover },
      { type: "highlight", days: 2 },
      { type: "bump" },
    ]) {
      const item = await create({ effect, isConsumable: effect.type !== "threadCover" });
      const bought = await call("shop.buy", { itemId: item.id });
      await expect(call("shop.use", { inventoryId: bought.inventory.id })).rejects.toBeInstanceOf(
        ValidationError,
      );
      for (const threadId of badIds) {
        const before = ctx.sqlite.prepare("SELECT * FROM threads WHERE id = ?1").get(threadId);
        await expect(
          call("shop.use", { inventoryId: bought.inventory.id, threadId }),
        ).rejects.toBeInstanceOf(NotFoundError);
        expect(ctx.sqlite.prepare("SELECT * FROM threads WHERE id = ?1").get(threadId)).toEqual(
          before,
        );
      }
      expect(
        await call("shop.use", { inventoryId: bought.inventory.id, threadId: visible }),
      ).toMatchObject({ quantity: effect.type === "threadCover" ? 1 : 0 });
    }
  });

  test("items that are worn, spent elsewhere or applied while held cannot be used", async () => {
    const { ctx, call, create, fund, expire, frameId, member } = fixture();
    fund();
    const color = insertPaletteColor(ctx, { kind: "name" });
    const rename = await create({ isConsumable: true, effect: { type: "usernameChange" } });
    const bought = await call("shop.buy", { itemId: rename.id });
    const refusedRename = await call("shop.use", { inventoryId: bought.inventory.id }).catch(
      (error: unknown) => error,
    );
    expect(refusedRename).toBeInstanceOf(ConflictError);
    expect((refusedRename as Error).message).toMatch(/users\.changeUsername/);
    expect(ctx.sqlite.prepare("SELECT username FROM users WHERE id = ?1").get(member.id)).toEqual({
      username: member.username,
    });
    await expect(
      call("shop.use", { inventoryId: bought.inventory.id, threadId: 1 }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(
      ctx.sqlite
        .prepare("SELECT quantity, state FROM shop_inventory WHERE id = ?1")
        .get(bought.inventory.id),
    ).toEqual({ quantity: 1, state: "unused" });
    for (const effect of [
      { type: "frame", frameId },
      { type: "nameColor", colorId: color },
    ]) {
      const item = await create({ effect, durationSeconds: 60 });
      const owned = await call("shop.buy", { itemId: item.id });
      const refusedWear = await call("shop.use", { inventoryId: owned.inventory.id }).catch(
        (error: unknown) => error,
      );
      expect(refusedWear).toBeInstanceOf(ConflictError);
      expect((refusedWear as Error).message).toMatch(/appearance\.set/);
      await expect(
        call("shop.use", { inventoryId: owned.inventory.id, threadId: 1 }),
      ).rejects.toBeInstanceOf(ConflictError);
      ctx.clock.advance(60_001);
      await expire();
      await expect(call("shop.use", { inventoryId: owned.inventory.id })).rejects.toBeInstanceOf(
        ConflictError,
      );
    }
  });
});
