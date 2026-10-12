import { afterEach, describe, expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
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
import { can } from "../../permissions";
import { moveCredits } from "../../shared/credits";
import { operations as appearanceOperations } from "../appearance";
import { insertCatalogImage, insertPaletteColor } from "../appearance/catalog-fixtures";
import { operations as forumOperations } from "../forums";
import { operations } from "./index";

const contexts: ReturnType<typeof createTestContext>[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

function fixture() {
  const ctx = createTestContext();
  contexts.push(ctx);
  const adminRow = insertUser(ctx, { groupId: 4 });
  const admin = userActor(adminRow);
  const member = insertUser(ctx);
  const other = insertUser(ctx);
  const actor = userActor(member);
  const all: AnyOperation[] = [...operations, ...forumOperations, ...appearanceOperations];
  const call = (name: string, input: unknown = {}, as: Actor = actor) =>
    // biome-ignore lint/suspicious/noExplicitAny: tests read the output of any operation
    execute(ctx, all.find((op) => op.name === name)!, as, input) as Promise<any>;
  const fund = (id = member.id, amount = 1000) =>
    writeTx(ctx, () => moveCredits(ctx, [{ userId: id, amount, type: "adjustment" }]));
  const category = (
    call("shopCategories.create", { name: "Catalog" }, admin) as Promise<{
      id: number;
    }>
  ).then((c) => c.id);
  const sell = async (effect: object, fields: object = {}) =>
    call(
      "shopItems.create",
      { categoryId: await category, name: "Item", price: 10, effect, ...fields },
      admin,
    );
  return { ctx, admin, adminRow, member, other, actor, call, fund, sell, category };
}

describe("shop items name catalog entries", () => {
  test("a frame must be an existing, usable entry of the frame catalog", async () => {
    const { ctx, call, sell } = fixture();
    const good = insertCatalogImage(ctx, "frame");
    const cover = insertCatalogImage(ctx, "profile_cover");
    const noPicture = insertCatalogImage(ctx, "frame", { picture: false });
    const inactive = insertCatalogImage(ctx, "frame", { active: false });
    expect(await sell({ type: "frame", frameId: good })).toMatchObject({
      effect: { type: "frame", frameId: good },
    });
    for (const frameId of [999999, cover, noPicture, inactive])
      await expect(sell({ type: "frame", frameId })).rejects.toBeInstanceOf(ValidationError);
    // Nothing was created by the refused attempts.
    expect(
      ctx.sqlite.prepare<{ n: number }, []>("SELECT COUNT(*) AS n FROM shop_items").get()!.n,
    ).toBe(1);
    await expect(call("shopItems.list", { categoryId: 1 })).resolves.toBeDefined();
  });

  test("a thread cover must be an entry of the thread cover catalog", async () => {
    const { ctx, sell } = fixture();
    const good = insertCatalogImage(ctx, "thread_cover");
    expect(await sell({ type: "threadCover", coverId: good })).toMatchObject({
      effect: { coverId: good },
    });
    for (const coverId of [
      insertCatalogImage(ctx, "frame"),
      insertCatalogImage(ctx, "thread_cover", { picture: false }),
      insertCatalogImage(ctx, "thread_cover", { active: false }),
      999999,
    ])
      await expect(sell({ type: "threadCover", coverId })).rejects.toBeInstanceOf(ValidationError);
  });

  test("a name colour must be an active colour of the name palette", async () => {
    const { ctx, sell } = fixture();
    const good = insertPaletteColor(ctx, { kind: "name" });
    expect(await sell({ type: "nameColor", colorId: good })).toMatchObject({
      effect: { colorId: good },
    });
    for (const colorId of [
      insertPaletteColor(ctx, { kind: "accent" }),
      insertPaletteColor(ctx, { kind: "name", active: false }),
      999999,
    ])
      await expect(sell({ type: "nameColor", colorId })).rejects.toBeInstanceOf(ValidationError);
  });

  test("updating checks the entry too, and an item that is not for sale may wait for its picture", async () => {
    const { ctx, call, admin, sell } = fixture();
    const good = insertCatalogImage(ctx, "frame");
    const waiting = insertCatalogImage(ctx, "frame", { picture: false, active: false });
    const item = await sell({ type: "frame", frameId: good });
    await expect(
      call(
        "shopItems.update",
        { itemId: item.id, effect: { type: "frame", frameId: 999999 } },
        admin,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      call(
        "shopItems.update",
        { itemId: item.id, effect: { type: "frame", frameId: waiting } },
        admin,
      ),
    ).rejects.toBeInstanceOf(ValidationError);
    // An item for sale needs an active entry; one that is not for sale does not.
    ctx.sqlite
      .prepare("UPDATE shop_items SET effect = ?1, is_active = 0 WHERE id = ?2")
      .run(JSON.stringify({ type: "frame", frameId: waiting }), item.id);
    expect(
      await call("shopItems.update", { itemId: item.id, name: "Renamed" }, admin),
    ).toMatchObject({ name: "Renamed", isActive: false });
    await expect(
      call("shopItems.update", { itemId: item.id, isActive: true }, admin),
    ).rejects.toBeInstanceOf(ValidationError);
    ctx.sqlite
      .prepare("UPDATE shop_items SET effect = ?1 WHERE id = ?2")
      .run(JSON.stringify({ type: "frame", frameId: good }), item.id);
    expect(
      await call("shopItems.update", { itemId: item.id, isActive: true }, admin),
    ).toMatchObject({ isActive: true });
  });

  test("deactivating an entry leaves the item as it is and members keep what they hold", async () => {
    const { ctx, call, fund, sell, member, admin } = fixture();
    fund();
    const frameId = insertCatalogImage(ctx, "frame");
    const item = await sell({ type: "frame", frameId });
    await call("shop.buy", { itemId: item.id });
    ctx.sqlite.prepare("UPDATE catalog_images SET is_active = 0 WHERE id = ?1").run(frameId);
    invalidate(ctx, "appearance");
    // The item can still be edited while its entry is inactive.
    expect(await call("shopItems.update", { itemId: item.id, price: 12 }, admin)).toMatchObject({
      price: 12,
      isActive: true,
    });
    expect(
      ctx.sqlite.prepare("SELECT is_active FROM shop_items WHERE id = ?1").get(item.id),
    ).toEqual({ is_active: 1 });
    expect(
      (await call("appearance.get")).available.frames.map((f: { id: number }) => f.id),
    ).toEqual([frameId]);
    expect(await call("appearance.set", { frameId })).toMatchObject({ frameId });
    expect(ctx.sqlite.prepare("SELECT frame_id FROM users WHERE id = ?1").get(member.id)).toEqual({
      frame_id: frameId,
    });
  });
});

describe("shop.use on a thread", () => {
  async function threadWorld() {
    const f = fixture();
    f.fund();
    f.fund(f.other.id);
    const node = insertNode(f.ctx, {});
    invalidate(f.ctx, "node_tree");
    const threads = async (as: Actor = f.actor) =>
      (await f.call("threads.create", { nodeId: node.id, title: "Mine", body: "Hello" }, as)) as {
        thread: { id: number };
      };
    const mine = (await threads()).thread.id;
    const row = (id: number) =>
      f.ctx.sqlite
        .prepare<
          {
            reply_count: number;
            last_post_at: number;
            last_post_id: number;
            bumped_at: number | null;
            highlighted_until: number | null;
            cover_id: number | null;
            sort_at: number;
            content_updated_at: number;
          },
          [number]
        >(
          "SELECT reply_count, last_post_at, last_post_id, bumped_at, highlighted_until, cover_id, sort_at, content_updated_at FROM threads WHERE id = ?1",
        )
        .get(id)!;
    const use = async (effect: object, fields: object = {}, threadId = mine) => {
      const item = await f.sell(effect, { isConsumable: true, ...fields });
      const bought = await f.call("shop.buy", { itemId: item.id, quantity: 2 });
      return {
        item,
        inventoryId: bought.inventory.id as number,
        use: () => f.call("shop.use", { inventoryId: bought.inventory.id, threadId }),
      };
    };
    return { ...f, node, mine, row, use, threads };
  }

  test("a cover sets the thread's cover, which lists and the thread then show", async () => {
    const w = await threadWorld();
    const coverId = insertCatalogImage(w.ctx, "thread_cover");
    const { use } = await w.use({ type: "threadCover", coverId });
    expect(w.row(w.mine).cover_id).toBeNull();
    const before = w.row(w.mine).content_updated_at;
    w.ctx.clock.advance(1000);
    expect(await use()).toMatchObject({ quantity: 1, state: "unused" });
    expect(w.row(w.mine)).toMatchObject({ cover_id: coverId, content_updated_at: before + 1000 });
    const thread = (await w.call("threads.get", { threadId: w.mine })).thread;
    expect(thread.cover.url).toBe(
      `/api/v1/files/${
        w.ctx.sqlite
          .prepare<{ file_id: number }, [number]>(
            "SELECT file_id FROM catalog_images WHERE id = ?1",
          )
          .get(coverId)!.file_id
      }`,
    );
    const listed = await w.call("threads.list", { nodeId: w.node.id });
    expect(listed.items[0].cover.url).toBe(thread.cover.url);
    expect(
      w.ctx.sqlite.prepare("SELECT payload FROM domain_events WHERE type = 'shop.item_used'").all(),
    ).toHaveLength(1);
  });

  test("an inactive cover still applies, but one without a picture does not and keeps the unit", async () => {
    const w = await threadWorld();
    const inactive = insertCatalogImage(w.ctx, "thread_cover");
    const { use, inventoryId } = await w.use({ type: "threadCover", coverId: inactive });
    w.ctx.sqlite.prepare("UPDATE catalog_images SET is_active = 0 WHERE id = ?1").run(inactive);
    invalidate(w.ctx, "appearance");
    await use();
    expect(w.row(w.mine).cover_id).toBe(inactive);
    const bare = insertCatalogImage(w.ctx, "thread_cover");
    const second = await w.use({ type: "threadCover", coverId: bare });
    w.ctx.sqlite.prepare("UPDATE catalog_images SET file_id = NULL WHERE id = ?1").run(bare);
    invalidate(w.ctx, "appearance");
    await expect(second.use()).rejects.toBeInstanceOf(ConflictError);
    expect(
      w.ctx.sqlite
        .prepare("SELECT quantity, state FROM shop_inventory WHERE id = ?1")
        .get(second.inventoryId),
    ).toEqual({ quantity: 2, state: "unused" });
    expect(w.row(w.mine).cover_id).toBe(inactive);
    expect(inventoryId).toBeGreaterThan(0);
  });

  test("a highlight adds days to the later of now and the current end", async () => {
    const w = await threadWorld();
    const { use } = await w.use({ type: "highlight", days: 2 });
    const day = 86_400_000;
    await use();
    expect(w.row(w.mine).highlighted_until).toBe(w.ctx.now() + 2 * day);
    const first = w.row(w.mine).highlighted_until!;
    w.ctx.clock.advance(day);
    await use();
    expect(w.row(w.mine).highlighted_until).toBe(first + 2 * day);
    expect((await w.call("threads.get", { threadId: w.mine })).thread.highlightedUntil).toBe(
      new Date(first + 2 * day).toISOString(),
    );
    // Once it has ended, the next one counts from now.
    const again = await w.use({ type: "highlight", days: 1 }, { name: "Another" });
    w.ctx.clock.advance(10 * day);
    await again.use();
    expect(w.row(w.mine).highlighted_until).toBe(w.ctx.now() + day);
  });

  test("a bump moves the thread to the top without becoming a post", async () => {
    const w = await threadWorld();
    const other = userActor(w.other);
    const second = (await w.threads(other)).thread.id;
    w.ctx.clock.advance(60_000);
    const third = (await w.threads(other)).thread.id;
    const order = async () =>
      (await w.call("threads.list", { nodeId: w.node.id })).items.map((t: { id: number }) => t.id);
    expect(await order()).toEqual([third, second, w.mine]);
    await w.call("threads.markRead", { threadId: w.mine, position: 0 });
    const reader = userActor(insertUser(w.ctx));
    await w.call("threads.markRead", { threadId: w.mine, position: 0 }, reader);
    const counters = () =>
      JSON.stringify([
        w.ctx.sqlite.prepare("SELECT * FROM nodes WHERE id = ?1").get(w.node.id),
        w.ctx.sqlite
          .prepare(
            "SELECT reply_count, last_post_at, last_post_id, last_poster_id, first_post_id FROM threads WHERE id = ?1",
          )
          .get(w.mine),
        w.ctx.sqlite.prepare("SELECT post_count FROM users").all(),
        w.ctx.sqlite.prepare("SELECT * FROM thread_reads ORDER BY thread_id, user_id").all(),
        w.ctx.sqlite.prepare("SELECT COUNT(*) AS n FROM posts").get(),
      ]);
    const before = counters();
    const lastPostBefore = (await w.call("threads.get", { threadId: w.mine })).thread.lastPost;
    w.ctx.clock.advance(60_000);
    const { use } = await w.use({ type: "bump" });
    await use();
    expect(counters()).toBe(before);
    expect(w.row(w.mine).bumped_at).toBe(w.ctx.now());
    expect(await order()).toEqual([w.mine, third, second]);
    const after = (await w.call("threads.get", { threadId: w.mine }, reader)).thread;
    expect(after.lastPost).toEqual(lastPostBefore);
    expect(after.isUnread).toBe(false);
    expect(after.bumpedAt).toBe(new Date(w.ctx.now()).toISOString());
  });

  test("items that are not for a thread, and threads that are not the member's, are refused", async () => {
    const w = await threadWorld();
    const { inventoryId } = await w.use({ type: "bump" });
    const theirs = (await w.threads(userActor(w.other))).thread.id;
    await expect(w.call("shop.use", { inventoryId, threadId: theirs })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const moderator = userActor(insertUser(w.ctx, { groupId: 3 }));
    await expect(
      w.call("shop.use", { inventoryId, threadId: w.mine }, moderator),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      w.call("shop.use", { inventoryId, threadId: w.mine }, GUEST),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    const unconfirmed = userActor(insertUser(w.ctx, { groupId: 5 }));
    await expect(
      w.call("shop.use", { inventoryId, threadId: w.mine }, unconfirmed),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(w.call("shop.use", { inventoryId })).rejects.toBeInstanceOf(ValidationError);
    expect(w.row(w.mine).bumped_at).toBeNull();
  });

  test("a merged-away thread is not found", async () => {
    const w = await threadWorld();
    const { inventoryId } = await w.use({ type: "bump" });
    const target = (await w.threads()).thread.id;
    w.ctx.sqlite
      .prepare("UPDATE threads SET merged_into_id = ?1 WHERE id = ?2")
      .run(target, w.mine);
    await expect(w.call("shop.use", { inventoryId, threadId: w.mine })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("shop.buy: nothing to buy", () => {
  test("a yes/no permission the buyer already has is a conflict, for self and for a gift", async () => {
    const f = fixture();
    f.fund();
    f.fund(f.adminRow.id);
    const moderator = insertUser(f.ctx, { groupId: 3 });
    f.fund(moderator.id);
    // A moderator has profile.signature through their group.
    const item = await f.sell(
      { type: "permission", permission: "profile.signature" },
      { isGiftable: true },
    );
    const before = JSON.stringify(f.ctx.sqlite.prepare("SELECT * FROM shop_inventory").all());
    await expect(
      f.call("shop.buy", { itemId: item.id }, userActor(moderator)),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      f.call("shop.buy", { itemId: item.id, recipientId: moderator.id }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(JSON.stringify(f.ctx.sqlite.prepare("SELECT * FROM shop_inventory").all())).toBe(before);
    expect(
      f.ctx.sqlite
        .prepare<{ credits: number }, [number]>("SELECT credits FROM users WHERE id = ?1")
        .get(f.member.id)!.credits,
    ).toBe(1000);
    // A member who lacks it can buy it, and a gift to such a member works.
    expect(can(f.ctx, f.actor, "profile.signature")).toBe(false);
    await f.call("shop.buy", { itemId: item.id });
    expect(can(f.ctx, f.actor, "profile.signature")).toBe(true);
    await expect(f.call("shop.buy", { itemId: item.id })).rejects.toBeInstanceOf(ConflictError);
    const gifted = await f.call("shop.buy", { itemId: item.id, recipientId: f.other.id });
    expect(gifted.inventory).toBeNull();
    expect(can(f.ctx, userActor(f.other), "profile.signature")).toBe(true);
  });

  test("integer permissions and consumable permissions are not affected", async () => {
    const f = fixture();
    f.fund();
    f.fund(f.adminRow.id);
    const moderator = insertUser(f.ctx, { groupId: 3 });
    f.fund(moderator.id);
    const integer = await f.sell({
      type: "permission",
      permission: "profile.awardSlots",
      value: 50,
    });
    const consumable = await f.sell(
      { type: "permission", permission: "profile.signature" },
      { isConsumable: true },
    );
    expect(await f.call("shop.buy", { itemId: integer.id }, userActor(moderator))).toMatchObject({
      purchase: { price: 10 },
    });
    expect(await f.call("shop.buy", { itemId: consumable.id }, userActor(moderator))).toMatchObject(
      { purchase: { price: 10 } },
    );
  });
});

describe("shop.upgrade", () => {
  async function ranks() {
    const f = fixture();
    f.fund();
    const permission = (groupId: number, key: string) =>
      f.ctx.sqlite
        .prepare(
          "INSERT INTO permission_entries (group_id, user_id, node_id, permission_id, value) SELECT ?1, 0, 0, id, 1 FROM permission_definitions WHERE key = ?2",
        )
        .run(groupId, key);
    const group = (title: string, rank: number, key: string) => {
      const id = f.ctx.sqlite
        .prepare<{ id: number }, [string, number]>(
          "INSERT INTO groups (title, rank) VALUES (?1, ?2) RETURNING id",
        )
        .get(title, rank)!.id;
      permission(id, key);
      return id;
    };
    const bronze = group("Bronze", 20, "profile.signature");
    const silver = group("Silver", 30, "profile.customTitle");
    const gold = group("Gold", 40, "profile.renameFree");
    invalidate(f.ctx, "permissions");
    const itemFor = (name: string, price: number, groupId: number, fields: object = {}) =>
      f.sell({ type: "group", groupId }, { name, price, ...fields });
    return {
      ...f,
      groups: { bronze, silver, gold },
      bronze: await itemFor("Bronze", 100, bronze),
      silver: await itemFor("Silver", 250, silver),
      gold: await itemFor("Gold", 600, gold),
      itemFor,
      balance: () =>
        f.ctx.sqlite
          .prepare<{ credits: number }, [number]>("SELECT credits FROM users WHERE id = ?1")
          .get(f.member.id)!.credits,
      holds: (key: string) => can(f.ctx, f.actor, key as never),
      state: () =>
        f.ctx.sqlite
          .prepare("SELECT item_id, state FROM shop_inventory WHERE user_id = ?1 ORDER BY item_id")
          .all(f.member.id),
    };
  }

  test("with no current rank it is a purchase at the full price", async () => {
    const r = await ranks();
    const result = await r.call("shop.upgrade", { itemId: r.silver.id });
    expect(result).toMatchObject({
      replacedItemId: null,
      balance: 750,
      purchase: { price: 250, quantity: 1, item: { id: r.silver.id } },
      inventory: { state: "active", item: { id: r.silver.id } },
    });
    expect(r.holds("profile.customTitle")).toBe(true);
  });

  test("three ranks bottom to top in two steps total the top price, and each group's permissions follow", async () => {
    const r = await ranks();
    await r.call("shop.buy", { itemId: r.bronze.id });
    expect(r.holds("profile.signature")).toBe(true);
    expect(r.balance()).toBe(900);

    const toSilver = await r.call("shop.upgrade", { itemId: r.silver.id });
    expect(toSilver).toMatchObject({
      replacedItemId: r.bronze.id,
      purchase: { price: 150 },
      balance: 750,
    });
    expect(r.holds("profile.signature")).toBe(false);
    expect(r.holds("profile.customTitle")).toBe(true);
    expect(r.holds("profile.renameFree")).toBe(false);

    const toGold = await r.call("shop.upgrade", { itemId: r.gold.id });
    expect(toGold).toMatchObject({ replacedItemId: r.silver.id, purchase: { price: 350 } });
    expect(r.holds("profile.customTitle")).toBe(false);
    expect(r.holds("profile.renameFree")).toBe(true);

    expect(r.balance()).toBe(1000 - 600);
    expect(r.state()).toEqual([
      { item_id: r.bronze.id, state: "expired" },
      { item_id: r.silver.id, state: "expired" },
      { item_id: r.gold.id, state: "active" },
    ]);
    const paid = r.ctx.sqlite
      .prepare<{ total: number; n: number }, [number]>(
        "SELECT SUM(price) AS total, COUNT(*) AS n FROM shop_purchases WHERE buyer_id = ?1",
      )
      .get(r.member.id)!;
    expect(paid).toEqual({ total: 600, n: 3 });
    expect(
      r.ctx.sqlite.prepare("SELECT shop_purchase_count FROM users WHERE id = ?1").get(r.member.id),
    ).toEqual({ shop_purchase_count: 3 });
    expect(
      r.ctx.sqlite
        .prepare("SELECT COUNT(*) AS n FROM shop_group_grants WHERE user_id = ?1")
        .get(r.member.id),
    ).toEqual({ n: 1 });
    const events = r.ctx.sqlite
      .prepare<{ payload: string }, []>(
        "SELECT payload FROM domain_events WHERE type = 'member.groups_changed' ORDER BY id",
      )
      .all()
      .map((e) => JSON.parse(e.payload));
    expect(events.at(-1)).toEqual({
      added: [r.groups.gold],
      removed: [r.groups.silver],
      source: "shop",
    });
    // The ledger holds one charge per step.
    expect(
      r.ctx.sqlite
        .prepare("SELECT amount FROM credit_transactions WHERE type = 'purchase' ORDER BY id")
        .all(),
    ).toEqual([{ amount: -100 }, { amount: -150 }, { amount: -350 }]);
  });

  test("ranks only go up, and the new rank's own duration starts now", async () => {
    const r = await ranks();
    await r.call("shop.buy", { itemId: r.silver.id });
    for (const itemId of [r.silver.id, r.bronze.id])
      await expect(r.call("shop.upgrade", { itemId })).rejects.toThrow(/only go up/);
    const dearAsSilver = await r.itemFor("Silver plus", 250, r.groups.silver);
    await expect(r.call("shop.upgrade", { itemId: dearAsSilver.id })).rejects.toBeInstanceOf(
      ConflictError,
    );
    const timed = await r.itemFor("Timed gold", 400, r.groups.gold, { durationSeconds: 3600 });
    r.ctx.clock.advance(5000);
    const result = await r.call("shop.upgrade", { itemId: timed.id });
    expect(result.inventory.expiresAt).toBe(new Date(r.ctx.now() + 3_600_000).toISOString());
    expect(result.purchase.price).toBe(150);
  });

  test("only ranks of the same category count, and only group items can be upgraded to", async () => {
    const r = await ranks();
    await r.call("shop.buy", { itemId: r.bronze.id });
    const elsewhere = (await r.call("shopCategories.create", { name: "Other ranks" }, r.admin)) as {
      id: number;
    };
    const other = await r.call(
      "shopItems.create",
      {
        categoryId: elsewhere.id,
        name: "Platinum",
        price: 120,
        effect: { type: "group", groupId: r.groups.gold },
      },
      r.admin,
    );
    expect(await r.call("shop.upgrade", { itemId: other.id })).toMatchObject({
      replacedItemId: null,
      purchase: { price: 120 },
    });
    expect(r.state().filter((row) => (row as { state: string }).state === "active")).toHaveLength(
      2,
    );
    const frame = await r.sell({ type: "bump" });
    await expect(r.call("shop.upgrade", { itemId: frame.id })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("a short balance, a sold-out rank and an unavailable rank change nothing", async () => {
    const r = await ranks();
    await r.call("shop.buy", { itemId: r.bronze.id });
    const snapshot = () =>
      JSON.stringify([
        r.ctx.sqlite.prepare("SELECT * FROM shop_inventory").all(),
        r.ctx.sqlite.prepare("SELECT * FROM shop_purchases").all(),
        r.ctx.sqlite.prepare("SELECT * FROM shop_group_grants").all(),
        r.ctx.sqlite.prepare("SELECT credits, shop_purchase_count FROM users").all(),
        r.ctx.sqlite.prepare("SELECT stock FROM shop_items").all(),
      ]);
    r.ctx.sqlite.prepare("UPDATE users SET credits = 120 WHERE id = ?1").run(r.member.id);
    const poorBefore = snapshot();
    await expect(r.call("shop.upgrade", { itemId: r.gold.id })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(snapshot()).toBe(poorBefore);
    r.ctx.sqlite.prepare("UPDATE users SET credits = 1000 WHERE id = ?1").run(r.member.id);
    r.ctx.sqlite.prepare("UPDATE shop_items SET stock = 0 WHERE id = ?1").run(r.silver.id);
    await expect(r.call("shop.upgrade", { itemId: r.silver.id })).rejects.toBeInstanceOf(
      ConflictError,
    );
    r.ctx.sqlite.prepare("UPDATE shop_items SET is_active = 0 WHERE id = ?1").run(r.gold.id);
    await expect(r.call("shop.upgrade", { itemId: r.gold.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(r.holds("profile.signature")).toBe(true);
    expect(r.state()).toEqual([{ item_id: r.bronze.id, state: "active" }]);
  });

  test("stock goes down by one and guests and unconfirmed members are refused", async () => {
    const r = await ranks();
    const limited = await r.itemFor("Limited", 300, r.groups.gold, { stock: 2 });
    await r.call("shop.upgrade", { itemId: limited.id });
    expect(
      r.ctx.sqlite.prepare("SELECT stock FROM shop_items WHERE id = ?1").get(limited.id),
    ).toEqual({ stock: 1 });
    await expect(r.call("shop.upgrade", { itemId: r.gold.id }, GUEST)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await expect(
      r.call("shop.upgrade", { itemId: r.gold.id }, userActor(insertUser(r.ctx, { groupId: 5 }))),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
