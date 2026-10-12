import { afterEach, describe, expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { closeContext } from "../../context";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from "../../errors";
import { type AnyOperation, execute } from "../../operation";
import { operations } from "./index";

const contexts: ReturnType<typeof createTestContext>[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});
function fixture() {
  const ctx = createTestContext();
  contexts.push(ctx);
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const member = userActor(insertUser(ctx));
  const moderator = userActor(insertUser(ctx, { groupId: 3 }));
  const call = (name: string, input: unknown = {}, actor = admin) => {
    const op: AnyOperation = operations.find((op) => op.name === name)!;
    return execute(ctx, op, actor, input);
  };
  return { ctx, admin, member, moderator, call };
}

describe("shop catalog", () => {
  test("category CRUD, display order and visibility", async () => {
    const { call, member, moderator } = fixture();
    const later = await call("shopCategories.create", { name: "Later", position: 2 });
    const hidden = await call("shopCategories.create", { name: "Hidden", isActive: false });
    for (const actor of [GUEST, member, moderator]) {
      expect(
        (await call("shopCategories.list", {}, actor)).items.map((x: { id: number }) => x.id),
      ).toEqual([later.id]);
    }
    expect((await call("shopCategories.list")).items.map((x: { id: number }) => x.id)).toEqual([
      hidden.id,
      later.id,
    ]);
    expect(
      await call("shopCategories.update", { categoryId: later.id, name: "First", position: 0 }),
    ).toMatchObject({ name: "First", position: 0 });
    expect(await call("shopCategories.delete", { categoryId: hidden.id })).toEqual({ ok: true });
    for (const name of ["shopCategories.update", "shopCategories.delete"]) {
      await expect(call(name, { categoryId: 999999 })).rejects.toBeInstanceOf(NotFoundError);
    }
  });

  test("item CRUD, pagination, inactive categories and nonempty deletion", async () => {
    const { call, member, moderator } = fixture();
    const category = await call("shopCategories.create", { name: "Catalog" });
    const input = {
      categoryId: category.id,
      name: "Frame",
      price: 7,
      effect: { type: "frame", frame: "gold" },
    };
    const first = await call("shopItems.create", input);
    const second = await call("shopItems.create", { ...input, position: 2 });
    const hidden = await call("shopItems.create", { ...input, isActive: false });
    for (const actor of [GUEST, member, moderator]) {
      expect(await call("shopItems.get", { itemId: first.id }, actor)).toMatchObject({
        price: 7,
        stock: null,
      });
      await expect(call("shopItems.get", { itemId: hidden.id }, actor)).rejects.toBeInstanceOf(
        NotFoundError,
      );
      const page = await call("shopItems.list", { categoryId: category.id, limit: 1 }, actor);
      expect(page.items.map((x: { id: number }) => x.id)).toEqual([first.id]);
      const next = await call(
        "shopItems.list",
        { categoryId: category.id, limit: 1, cursor: page.nextCursor },
        actor,
      );
      expect(next.items.map((x: { id: number }) => x.id)).toEqual([second.id]);
      expect(next.nextCursor).toBeNull();
    }
    expect((await call("shopItems.list", { categoryId: category.id })).items).toHaveLength(3);
    await expect(call("shopCategories.delete", { categoryId: category.id })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(await call("shopItems.update", { itemId: first.id, price: 8, stock: 0 })).toMatchObject({
      price: 8,
      stock: 0,
    });
    await call("shopCategories.update", { categoryId: category.id, isActive: false });
    await expect(call("shopItems.get", { itemId: first.id }, GUEST)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await call("shopItems.list", { categoryId: category.id }, GUEST)).items).toEqual([]);
    expect(await call("shopItems.get", { itemId: first.id })).toMatchObject({ id: first.id });
    expect(await call("shopItems.delete", { itemId: hidden.id })).toEqual({ ok: true });
    for (const name of ["shopItems.get", "shopItems.update", "shopItems.delete"]) {
      await expect(call(name, { itemId: 999999 })).rejects.toBeInstanceOf(NotFoundError);
    }
    await expect(call("shopItems.create", { ...input, categoryId: 999999 })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      call("shopItems.list", { categoryId: category.id, cursor: "invalid" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("every catalog write enforces admin.shop for guests, members and moderators", async () => {
    const { call, member, moderator } = fixture();
    const inputs: Record<string, unknown> = {
      "shopCategories.create": { name: "X" },
      "shopCategories.update": { categoryId: 1 },
      "shopCategories.delete": { categoryId: 1 },
      "shopItems.create": { categoryId: 1, name: "X", price: 0, effect: { type: "bump" } },
      "shopItems.update": { itemId: 1 },
      "shopItems.delete": { itemId: 1 },
    };
    for (const [name, input] of Object.entries(inputs)) {
      await expect(call(name, input, GUEST)).rejects.toBeInstanceOf(UnauthenticatedError);
      for (const actor of [member, moderator])
        await expect(call(name, input, actor)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  test("validates consumables, purchased grants and group ranks", async () => {
    const { ctx, call } = fixture();
    const category = await call("shopCategories.create", { name: "Catalog" });
    const input = { categoryId: category.id, name: "X", price: 0 };
    for (const fields of [
      { isConsumable: true, durationSeconds: 60, effect: { type: "bump" } },
      { isConsumable: true, effect: { type: "group", groupId: 2 } },
      { effect: { type: "permission", permission: "missing" } },
      { effect: { type: "permission", permission: "admin.shop" } },
      { effect: { type: "permission", permission: "forum.reply", value: 1 } },
      { effect: { type: "group", groupId: 1 } },
      { effect: { type: "group", groupId: 4 } },
    ])
      await expect(call("shopItems.create", { ...input, ...fields })).rejects.toBeInstanceOf(
        ValidationError,
      );
    const group = ctx.sqlite
      .prepare<{ id: number }, []>(
        "INSERT INTO groups (title, rank) SELECT 'Equal', rank FROM groups WHERE id = 4 RETURNING id",
      )
      .get()!;
    await expect(
      call("shopItems.create", { ...input, effect: { type: "group", groupId: group.id } }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      call("shopItems.create", { ...input, effect: { type: "group", groupId: 999999 } }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("shop administrators need admin.permissions for every change involving grants", async () => {
    const { ctx, call } = fixture();
    const manager = insertUser(ctx);
    ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (group_id, user_id, node_id, permission_id, value) SELECT 0, ?1, 0, id, 1 FROM permission_definitions WHERE key = 'admin.shop'",
      )
      .run(manager.id);
    const actor = userActor(manager);
    const category = await call("shopCategories.create", { name: "Manager's catalog" }, actor);
    const base = { categoryId: category.id, name: "X", price: 0 };
    const normal = await call("shopItems.create", { ...base, effect: { type: "bump" } }, actor);
    for (const effect of [
      { type: "permission", permission: "profilePost.viewDeleted" },
      { type: "group", groupId: 2 },
    ]) {
      await expect(call("shopItems.create", { ...base, effect }, actor)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(
        call("shopItems.update", { itemId: normal.id, effect }, actor),
      ).rejects.toBeInstanceOf(ForbiddenError);
      const grant = await call("shopItems.create", { ...base, effect });
      for (const change of [{ price: 2 }, { isActive: false }, { effect: { type: "bump" } }])
        await expect(
          call("shopItems.update", { itemId: grant.id, ...change }, actor),
        ).rejects.toBeInstanceOf(ForbiddenError);
      expect(await call("shopItems.update", { itemId: grant.id, price: 1 })).toMatchObject({
        price: 1,
      });
      expect(await call("shopItems.delete", { itemId: grant.id }, actor)).toEqual({ ok: true });
    }
    const integerEffect = {
      type: "permission",
      permission: "conversation.maxRecipients",
      value: 8,
    };
    expect(await call("shopItems.create", { ...base, effect: integerEffect })).toMatchObject({
      effect: integerEffect,
    });
    await expect(
      call("shopItems.create", { ...base, effect: { ...integerEffect, value: undefined } }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("a holder of only admin.shop deletes unsold grant items, but a bought one conflicts", async () => {
    const { ctx, call } = fixture();
    const manager = insertUser(ctx);
    ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (group_id, user_id, node_id, permission_id, value) SELECT 0, ?1, 0, id, 1 FROM permission_definitions WHERE key = 'admin.shop'",
      )
      .run(manager.id);
    const actor = userActor(manager);
    const category = await call("shopCategories.create", { name: "Grants" });
    const base = { categoryId: category.id, name: "X", price: 0 };
    for (const effect of [
      { type: "permission", permission: "profilePost.viewDeleted" },
      { type: "group", groupId: 2 },
    ]) {
      const unsold = await call("shopItems.create", { ...base, effect });
      expect(await call("shopItems.delete", { itemId: unsold.id }, actor)).toEqual({ ok: true });
      await expect(call("shopItems.get", { itemId: unsold.id })).rejects.toBeInstanceOf(
        NotFoundError,
      );
    }
    const bought = await call("shopItems.create", {
      ...base,
      effect: { type: "permission", permission: "profilePost.viewDeleted" },
    });
    await call("shop.buy", { itemId: bought.id }, userActor(insertUser(ctx)));
    await expect(call("shopItems.delete", { itemId: bought.id }, actor)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  test("changing away from a group item respects the existing group's rank; deleting needs only admin.shop", async () => {
    const { ctx, call } = fixture();
    const group = ctx.sqlite
      .prepare<{ id: number }, []>(
        "INSERT INTO groups (title, rank) VALUES ('Supporter', 30) RETURNING id",
      )
      .get()!;
    const category = await call("shopCategories.create", { name: "Ranks" });
    const item = await call("shopItems.create", {
      categoryId: category.id,
      name: "Rank",
      price: 0,
      effect: { type: "group", groupId: group.id },
    });
    ctx.sqlite
      .prepare("UPDATE groups SET rank = (SELECT rank FROM groups WHERE id = 4) WHERE id = ?1")
      .run(group.id);
    await expect(
      call("shopItems.update", { itemId: item.id, effect: { type: "frame", frame: "gold" } }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await call("shopItems.delete", { itemId: item.id })).toEqual({ ok: true });
  });
});
