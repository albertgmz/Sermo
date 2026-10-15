import { afterEach, describe, expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { type Actor, GUEST } from "../../actor";
import { closeContext } from "../../context";
import { writeTx } from "../../db/tx";
import { NotFoundError, ValidationError } from "../../errors";
import { type AnyOperation, execute } from "../../operation";
import { moveCredits } from "../../shared/credits";
import { insertCatalogImage } from "../appearance/catalog-fixtures";
import { operations } from "./index";

const contexts: ReturnType<typeof createTestContext>[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

const rule = (...conditions: object[]) => ({ match: "all", conditions });
const EVERYONE = rule();
const RICH = rule({ criterion: "credits_at_least", value: 50 });
const MODERATORS = rule({ criterion: "in_group", ids: [3] });

function fixture() {
  const ctx = createTestContext();
  contexts.push(ctx);
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const rich = insertUser(ctx);
  const poor = insertUser(ctx);
  const richTwo = insertUser(ctx);
  const frameId = insertCatalogImage(ctx, "frame");
  const call = (name: string, input: unknown, as: Actor) => {
    const op: AnyOperation = operations.find((op) => op.name === name)!;
    return execute(ctx, op, as, input);
  };
  writeTx(ctx, () =>
    moveCredits(ctx, [
      { userId: rich.id, amount: 100, type: "adjustment" },
      { userId: poor.id, amount: 100, type: "adjustment" },
      { userId: richTwo.id, amount: 100, type: "adjustment" },
    ]),
  );
  ctx.sqlite.prepare("UPDATE users SET credits = 10 WHERE id = ?1").run(poor.id);
  const category = (fields: Record<string, unknown> = {}) =>
    call("shopCategories.create", { name: "Catalog", ...fields }, admin);
  const item = (categoryId: number, fields: Record<string, unknown> = {}) =>
    call(
      "shopItems.create",
      { categoryId, name: "Frame", price: 5, effect: { type: "frame", frameId }, ...fields },
      admin,
    );
  const names = async (name: string, input: unknown, as: Actor) =>
    ((await call(name, input, as)) as { items: { name: string }[] }).items.map((i) => i.name);
  return {
    ctx,
    admin,
    call,
    category,
    item,
    names,
    rich: userActor(rich),
    poor: userActor(poor),
    richId: rich.id,
    poorId: poor.id,
    richTwoId: richTwo.id,
    moderator: userActor(insertUser(ctx, { groupId: 3 })),
  };
}

describe("shop rules: who can see and buy", () => {
  test("no conditions means everyone, as before", async () => {
    const f = fixture();
    const category = await f.category();
    await f.item(category.id);
    expect(category.rule).toEqual(EVERYONE);
    for (const as of [GUEST, f.poor, f.rich, f.admin]) {
      expect(await f.names("shopCategories.list", {}, as)).toEqual(["Catalog"]);
      expect(await f.names("shopItems.list", { categoryId: category.id }, as)).toEqual(["Frame"]);
    }
  });

  test("an item with a rule is hidden from members, and guests, who do not match", async () => {
    const f = fixture();
    const category = await f.category();
    const open = await f.item(category.id, { name: "Open" });
    const mine = await f.item(category.id, { name: "Rich only", rule: RICH });
    expect(mine.rule).toEqual(RICH);
    const list = (as: Actor) => f.names("shopItems.list", { categoryId: category.id }, as);
    expect(await list(f.rich)).toEqual(["Open", "Rich only"]);
    expect(await list(f.poor)).toEqual(["Open"]);
    expect(await list(GUEST)).toEqual(["Open"]);
    expect(await list(f.admin)).toEqual(["Open", "Rich only"]);
    expect((await f.call("shopItems.get", { itemId: mine.id }, f.rich)).name).toBe("Rich only");
    expect((await f.call("shopItems.get", { itemId: mine.id }, f.admin)).name).toBe("Rich only");
    for (const as of [f.poor, GUEST])
      await expect(f.call("shopItems.get", { itemId: mine.id }, as)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    expect((await f.call("shopItems.get", { itemId: open.id }, f.poor)).name).toBe("Open");
  });

  test("a category with a rule hides itself and every item in it", async () => {
    const f = fixture();
    const hidden = await f.category({ name: "Staff", rule: MODERATORS });
    const item = await f.item(hidden.id);
    const shown = await f.category({ name: "Public" });
    await f.item(shown.id, { name: "Public item" });
    expect(await f.names("shopCategories.list", {}, f.poor)).toEqual(["Public"]);
    expect(await f.names("shopCategories.list", {}, GUEST)).toEqual(["Public"]);
    expect(await f.names("shopCategories.list", {}, f.moderator)).toEqual(["Staff", "Public"]);
    expect(await f.names("shopCategories.list", {}, f.admin)).toEqual(["Staff", "Public"]);
    expect(await f.names("shopItems.list", { categoryId: hidden.id }, f.poor)).toEqual([]);
    expect(await f.names("shopItems.list", { categoryId: hidden.id }, f.moderator)).toEqual([
      "Frame",
    ]);
    await expect(f.call("shopItems.get", { itemId: item.id }, f.poor)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await f.call("shopItems.get", { itemId: item.id }, f.moderator)).id).toBe(item.id);
  });

  test("a page of items is full and complete when the rule hides some of them", async () => {
    const f = fixture();
    const category = await f.category();
    for (let i = 1; i <= 9; i++)
      await f.item(category.id, {
        name: `Item ${i}`,
        position: i,
        rule: i % 3 === 0 ? RICH : EVERYONE,
      });
    const seen: string[] = [];
    let cursor: string | undefined;
    const sizes: number[] = [];
    do {
      const page = (await f.call(
        "shopItems.list",
        { categoryId: category.id, limit: 2, cursor },
        f.poor,
      )) as { items: { name: string }[]; nextCursor: string | null };
      sizes.push(page.items.length);
      seen.push(...page.items.map((i) => i.name));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual(["Item 1", "Item 2", "Item 4", "Item 5", "Item 7", "Item 8"]);
    expect(sizes).toEqual([2, 2, 2]);
  });

  test("a member who does not match cannot buy, gift or upgrade to it; one who does, can", async () => {
    const f = fixture();
    const category = await f.category();
    const item = await f.item(category.id, { rule: RICH, isGiftable: true });
    const state = () => [
      f.ctx.sqlite.prepare("SELECT id FROM shop_purchases").all(),
      f.ctx.sqlite.prepare("SELECT credits FROM users ORDER BY id").all(),
    ];
    const before = state();
    for (const as of [f.poor, GUEST]) {
      await expect(f.call("shop.buy", { itemId: item.id }, as)).rejects.toThrow();
    }
    await expect(f.call("shop.buy", { itemId: item.id }, f.poor)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      f.call("shop.buy", { itemId: item.id, recipientId: f.richId }, f.poor),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(f.call("shop.upgrade", { itemId: item.id }, f.poor)).rejects.toThrow();
    expect(state()).toEqual(before);
    const bought = await f.call("shop.buy", { itemId: item.id }, f.rich);
    expect(bought.purchase.item.id).toBe(item.id);
  });

  test("a gift must also meet the rule of the item and of its category, recipient included", async () => {
    const f = fixture();
    const category = await f.category();
    const item = await f.item(category.id, { rule: RICH, isGiftable: true });
    const staffCategory = await f.category({ name: "Staff", rule: MODERATORS });
    const staffItem = await f.item(staffCategory.id, { isGiftable: true });
    const state = () => [
      f.ctx.sqlite.prepare("SELECT id FROM shop_purchases").all(),
      f.ctx.sqlite.prepare("SELECT credits FROM users ORDER BY id").all(),
    ];
    const before = state();
    // The buyer matches, the recipient does not: refused like a missing item.
    await expect(
      f.call("shop.buy", { itemId: item.id, recipientId: f.poorId }, f.rich),
    ).rejects.toBeInstanceOf(NotFoundError);
    // The item is open but its category is for moderators and the recipient is not one.
    await expect(
      f.call("shop.buy", { itemId: staffItem.id, recipientId: f.richId }, f.moderator),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(state()).toEqual(before);
    // A recipient who matches receives it.
    const sent = await f.call("shop.buy", { itemId: item.id, recipientId: f.richTwoId }, f.rich);
    expect(sent.purchase.recipient.id).toBe(f.richTwoId);
  });

  test("the rule is read when the member buys: spending below the threshold closes it", async () => {
    const f = fixture();
    const category = await f.category();
    const item = await f.item(category.id, { price: 60, rule: RICH, isConsumable: true });
    await f.call("shop.buy", { itemId: item.id }, f.rich);
    // 100 - 60 = 40 credits: no longer enough for the rule.
    await expect(f.call("shop.buy", { itemId: item.id }, f.rich)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("a manager is not refused for the catalog, but a hidden item is not for sale to them", async () => {
    const f = fixture();
    const category = await f.category();
    const item = await f.item(category.id, { rule: MODERATORS });
    expect((await f.call("shopItems.get", { itemId: item.id }, f.admin)).id).toBe(item.id);
    await expect(f.call("shop.buy", { itemId: item.id }, f.admin)).rejects.toThrow(
      "This item is not available.",
    );
  });

  test("a rule may only use cheap criteria, on create and on update", async () => {
    const f = fixture();
    const heavy = rule({ criterion: "warning_points_below", value: 3 });
    await expect(f.category({ rule: heavy })).rejects.toBeInstanceOf(ValidationError);
    const category = await f.category();
    await expect(
      f.call("shopCategories.update", { categoryId: category.id, rule: heavy }, f.admin),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(f.item(category.id, { rule: heavy })).rejects.toBeInstanceOf(ValidationError);
    const item = await f.item(category.id);
    await expect(
      f.call("shopItems.update", { itemId: item.id, rule: heavy }, f.admin),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      f.item(category.id, { rule: rule({ criterion: "in_group", ids: [9999] }) }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("updating without a rule keeps it; updating with one replaces it", async () => {
    const f = fixture();
    const category = await f.category({ rule: MODERATORS });
    const item = await f.item(category.id, { rule: RICH });
    const renamed = await f.call("shopItems.update", { itemId: item.id, name: "Renamed" }, f.admin);
    expect(renamed.rule).toEqual(RICH);
    const cleared = await f.call("shopItems.update", { itemId: item.id, rule: EVERYONE }, f.admin);
    expect(cleared.rule).toEqual(EVERYONE);
    const keptCategory = await f.call(
      "shopCategories.update",
      { categoryId: category.id, name: "Renamed" },
      f.admin,
    );
    expect(keptCategory.rule).toEqual(MODERATORS);
  });

  test("the rule itself is shown only to those who manage the shop", async () => {
    const f = fixture();
    const open = await f.category({ name: "Open" });
    const staff = await f.category({ name: "Staff", rule: MODERATORS });
    const item = await f.item(open.id, { rule: rule({ criterion: "is_member", ids: [f.richId] }) });
    expect((await f.call("shopItems.get", { itemId: item.id }, f.rich)).rule).toEqual(EVERYONE);
    expect(
      (await f.call("shopItems.get", { itemId: item.id }, f.admin)).rule.conditions,
    ).toHaveLength(1);
    const asModerator = await f.call("shopCategories.list", {}, f.moderator);
    expect(asModerator.items.map((entry: { rule: unknown }) => entry.rule)).toEqual([
      EVERYONE,
      EVERYONE,
    ]);
    const asAdmin = await f.call("shopCategories.list", {}, f.admin);
    expect(asAdmin.items.find((entry: { id: number }) => entry.id === staff.id).rule).toEqual(
      MODERATORS,
    );
  });

  test("a long run of hidden items is skipped and the visible ones after it are listed", async () => {
    const f = fixture();
    const category = await f.category();
    for (let i = 1; i <= 130; i++)
      await f.item(category.id, { name: `Hidden ${i}`, position: i, rule: MODERATORS });
    await f.item(category.id, { name: "Shown", position: 200 });
    expect(await f.names("shopItems.list", { categoryId: category.id, limit: 2 }, f.poor)).toEqual([
      "Shown",
    ]);
  });
});
