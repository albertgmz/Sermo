import { expect, setDefaultTimeout, test } from "bun:test";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import type { Actor } from "../../actor";
import type { Ctx } from "../../context";
import { writeTx } from "../../db/tx";
import { ForbiddenError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { can } from "../../permissions";
import { resolvedActor, sharedDatabase } from "../../permissions/test-contexts";
import { moveCredits } from "../../shared/credits";
import { insertCatalogImage } from "../appearance/catalog-fixtures";

// These tests are slow only when the full suite shares the machine (disk and CPU): the 5 s default is too short.
setDefaultTimeout(30_000);

const op = (name: string) => getOperation(name);

/**
 * A founder, a shop manager who gets `admin.shop` from a custom group, and a buyer holding a
 * consumable. `here` is the revoked member's process (actor resolved, permission state warm);
 * `elsewhere` is another process, where the founder removes the manager from the group or bans
 * the buyer.
 */
async function scenario() {
  const fixture = createTestContext();
  const founder = userActor(insertUser(fixture, { groupId: 4 }));
  const staffGroup = (await execute(fixture, op("groups.create"), founder, {
    title: "Shop managers",
    rank: 40,
  })) as { id: number };
  await execute(fixture, op("permissions.set"), founder, {
    groupId: staffGroup.id,
    entries: [{ permission: "admin.shop", value: "allow" }],
  });
  const staff = insertUser(fixture, { groupId: staffGroup.id });
  const buyer = insertUser(fixture);
  writeTx(fixture, () =>
    moveCredits(fixture, [{ userId: buyer.id, amount: 100, type: "adjustment" }]),
  );
  const category = (await execute(fixture, op("shopCategories.create"), founder, {
    name: "Catalog",
  })) as { id: number };
  const spareCategory = (await execute(fixture, op("shopCategories.create"), founder, {
    name: "Spare",
  })) as { id: number };
  const frameId = insertCatalogImage(fixture, "frame");
  const spareFrameId = insertCatalogImage(fixture, "frame");
  const itemInput = {
    categoryId: category.id,
    price: 10,
    isConsumable: true,
    effect: { type: "frame", frameId },
  };
  const item = (await execute(fixture, op("shopItems.create"), founder, {
    ...itemInput,
    name: "Frame",
  })) as { id: number };
  const spareItem = (await execute(fixture, op("shopItems.create"), founder, {
    ...itemInput,
    name: "Unsold",
  })) as { id: number };
  const buy = (itemId: number, quantity = 1) =>
    execute(fixture, op("shop.buy"), userActor(buyer), { itemId, quantity }) as Promise<{
      inventory: { id: number };
    }>;
  await buy(item.id, 3);
  // A consumable that acts on a thread, one that pays for a rename, and a rank to upgrade to.
  const bump = (await execute(fixture, op("shopItems.create"), founder, {
    categoryId: category.id,
    name: "Bump",
    price: 5,
    isConsumable: true,
    effect: { type: "bump" },
  })) as { id: number };
  const rename = (await execute(fixture, op("shopItems.create"), founder, {
    categoryId: category.id,
    name: "Rename",
    price: 5,
    isConsumable: true,
    effect: { type: "usernameChange" },
  })) as { id: number };
  const rankGroup = (await execute(fixture, op("groups.create"), founder, {
    title: "Supporters",
    rank: 10,
  })) as { id: number };
  const rank = (await execute(fixture, op("shopItems.create"), founder, {
    categoryId: category.id,
    name: "Rank",
    price: 20,
    effect: { type: "group", groupId: rankGroup.id },
  })) as { id: number };
  const bumped = await buy(bump.id, 3);
  await buy(rename.id);
  const node = insertNode(fixture, {});
  const threadId = fixture.sqlite
    .prepare<{ id: number }, [number, number]>(
      "INSERT INTO threads (node_id, user_id, title, state, created_at, last_post_at, last_poster_id) VALUES (?1, ?2, 'A thread', 'visible', 0, 0, ?2) RETURNING id",
    )
    .get(node.id, buyer.id)!.id;
  const database = sharedDatabase(fixture);
  const here = database.open();
  const elsewhere = database.open();
  const managerActor = resolvedActor(here, staff.id);
  const buyerActor = resolvedActor(here, buyer.id);
  expect(can(here, managerActor, "admin.shop")).toBe(true);
  expect(can(here, buyerActor, "shop.buy")).toBe(true);
  return {
    database,
    here,
    elsewhere,
    founder,
    staff,
    buyer,
    managerActor,
    buyerActor,
    category,
    spareCategory,
    item,
    spareItem,
    frameId,
    spareFrameId,
    rank,
    threadId,
    inventoryId: bumped.inventory.id,
  };
}

type Scenario = Awaited<ReturnType<typeof scenario>>;
interface Attempt {
  as: "manager" | "buyer";
  run: (ctx: Ctx, actor: Actor, s: Scenario) => Promise<unknown>;
}
const attempts: Record<string, Attempt> = {
  "shopCategories.create": {
    as: "manager",
    run: (ctx, actor) => execute(ctx, op("shopCategories.create"), actor, { name: "New" }),
  },
  "shopCategories.update": {
    as: "manager",
    run: (ctx, actor, s) =>
      execute(ctx, op("shopCategories.update"), actor, {
        categoryId: s.category.id,
        name: "Renamed",
      }),
  },
  "shopCategories.delete": {
    as: "manager",
    run: (ctx, actor, s) =>
      execute(ctx, op("shopCategories.delete"), actor, { categoryId: s.spareCategory.id }),
  },
  "shopItems.create": {
    as: "manager",
    run: (ctx, actor, s) =>
      execute(ctx, op("shopItems.create"), actor, {
        categoryId: s.category.id,
        name: "New",
        price: 5,
        effect: { type: "frame", frameId: s.spareFrameId },
      }),
  },
  "shopItems.update": {
    as: "manager",
    run: (ctx, actor, s) =>
      execute(ctx, op("shopItems.update"), actor, { itemId: s.item.id, price: 11 }),
  },
  "shopItems.delete": {
    as: "manager",
    run: (ctx, actor, s) => execute(ctx, op("shopItems.delete"), actor, { itemId: s.spareItem.id }),
  },
  "shop.buy": {
    as: "buyer",
    run: (ctx, actor, s) => execute(ctx, op("shop.buy"), actor, { itemId: s.item.id, quantity: 1 }),
  },
  "shop.use": {
    as: "buyer",
    run: (ctx, actor, s) =>
      execute(ctx, op("shop.use"), actor, { inventoryId: s.inventoryId, threadId: s.threadId }),
  },
  "shop.upgrade": {
    as: "buyer",
    run: (ctx, actor, s) => execute(ctx, op("shop.upgrade"), actor, { itemId: s.rank.id }),
  },
  "appearance.set": {
    as: "buyer",
    run: (ctx, actor, s) => execute(ctx, op("appearance.set"), actor, { frameId: s.frameId }),
  },
  "users.changeUsername": {
    as: "buyer",
    run: (ctx, actor) =>
      execute(ctx, op("users.changeUsername"), actor, { username: "Renamed Buyer" }),
  },
};
const revoke = {
  manager: (s: Scenario) =>
    execute(s.elsewhere, op("users.setGroups"), s.founder, {
      userId: s.staff.id,
      primaryGroupId: 2,
    }),
  buyer: (s: Scenario) =>
    execute(s.elsewhere, op("bans.create"), s.founder, {
      userId: s.buyer.id,
      reason: "Fraud",
      expiresAt: null,
    }),
};

const snapshot = (ctx: Ctx) =>
  JSON.stringify([
    ctx.sqlite.prepare("SELECT * FROM shop_categories ORDER BY id").all(),
    ctx.sqlite.prepare("SELECT * FROM shop_items ORDER BY id").all(),
    ctx.sqlite.prepare("SELECT * FROM shop_inventory ORDER BY id").all(),
    ctx.sqlite.prepare("SELECT * FROM shop_purchases ORDER BY id").all(),
    ctx.sqlite
      .prepare("SELECT id, credits, username, username_key, frame_id FROM users ORDER BY id")
      .all(),
  ]);
const actorOf = (s: Scenario, as: Attempt["as"]) =>
  as === "manager" ? s.managerActor : s.buyerActor;

for (const [name, attempt] of Object.entries(attempts))
  test(`${name} is refused to a member revoked meanwhile`, async () => {
    const s = await scenario();
    try {
      await revoke[attempt.as](s);
      const before = snapshot(s.elsewhere);
      await expect(attempt.run(s.here, actorOf(s, attempt.as), s)).rejects.toThrow(ForbiddenError);
      expect(snapshot(s.elsewhere)).toBe(before);
    } finally {
      s.database.close();
    }
  });

test("a member who was not revoked still acts from a second process", async () => {
  const s = await scenario();
  try {
    for (const attempt of Object.values(attempts))
      await attempt.run(s.here, actorOf(s, attempt.as), s);
    expect(
      s.elsewhere.sqlite
        .prepare<{ price: number }, [number]>("SELECT price FROM shop_items WHERE id = ?1")
        .get(s.item.id)!.price,
    ).toBe(11);
    expect(
      s.elsewhere.sqlite
        .prepare<{ quantity: number }, [number]>(
          "SELECT quantity FROM shop_inventory WHERE id = ?1",
        )
        .get(s.inventoryId)!.quantity,
    ).toBe(2);
  } finally {
    s.database.close();
  }
});
