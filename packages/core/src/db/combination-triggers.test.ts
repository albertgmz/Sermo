import { describe, expect, test } from "bun:test";
import type { Ctx } from "../context";
import { can, permissionValue } from "../permissions";
import { createTestContext, insertUser, userActor } from "../testing";

/** The combination a member must be on, computed from the tables the triggers watch. */
function expected(ctx: Ctx, userId: number) {
  const exists = (table: string, where: string) =>
    !!ctx.sqlite.prepare(`SELECT 1 FROM ${table} WHERE ${where} LIMIT 1`).get(userId);
  const isPrivate =
    exists("permission_entries", "group_id = 0 AND user_id = ?1") ||
    exists("shop_permission_grants", "user_id = ?1");
  const groups = ctx.sqlite
    .prepare<{ g: number }, [number]>(
      "SELECT group_id AS g FROM users WHERE id = ?1 UNION SELECT group_id FROM user_groups WHERE user_id = ?1 UNION SELECT group_id FROM user_group_grants WHERE user_id = ?1 UNION SELECT group_id FROM shop_group_grants WHERE user_id = ?1 ORDER BY g",
    )
    .all(userId)
    .map((row) => row.g);
  return { user_id: isPrivate ? userId : 0, group_ids: groups.join(",") };
}
function actual(ctx: Ctx, userId: number) {
  return ctx.sqlite
    .prepare<{ user_id: number; group_ids: string }, [number]>(
      "SELECT c.user_id, c.group_ids FROM users u LEFT JOIN permission_combinations c ON c.id = u.permission_combination_id WHERE u.id = ?1",
    )
    .get(userId)!;
}
function setup() {
  const ctx = createTestContext();
  const first = insertUser(ctx);
  const second = insertUser(ctx);
  const group = (title: string) =>
    ctx.sqlite
      .prepare<{ id: number }, [string]>(
        "INSERT INTO groups (title, rank) VALUES (?1, 5) RETURNING id",
      )
      .get(title)!.id;
  const definition = (key: string) =>
    ctx.sqlite
      .prepare<{ id: number }, [string]>("SELECT id FROM permission_definitions WHERE key = ?1")
      .get(key)!.id;
  const consistent = () => {
    for (const user of [first, second])
      expect(actual(ctx, user.id)).toEqual(expected(ctx, user.id));
  };
  return { ctx, first, second, group, definition, consistent };
}

describe("combination triggers cover UPDATE of the owner and of the group", () => {
  test("permission_entries: a member entry moved to another member", () => {
    const { ctx, first, second, definition, consistent } = setup();
    ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES (?1, 0, 0, ?2, -1)",
      )
      .run(definition("search.use"), first.id);
    expect(can(ctx, userActor(first), "search.use")).toBe(false);
    expect(can(ctx, userActor(second), "search.use")).toBe(true);
    ctx.sqlite
      .prepare("UPDATE permission_entries SET user_id = ?1 WHERE user_id = ?2")
      .run(second.id, first.id);
    consistent();
    expect(can(ctx, userActor(first), "search.use")).toBe(true);
    expect(can(ctx, userActor(second), "search.use")).toBe(false);
  });

  test("permission_entries: a member entry turned into a group entry and back", () => {
    const { ctx, first, group, definition, consistent } = setup();
    const groupId = group("Holders");
    ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES (?1, 0, 0, ?2, -1)",
      )
      .run(definition("search.use"), first.id);
    ctx.sqlite
      .prepare("UPDATE permission_entries SET user_id = 0, group_id = ?1 WHERE user_id = ?2")
      .run(groupId, first.id);
    consistent();
    expect(actual(ctx, first.id).user_id).toBe(0);
    expect(can(ctx, userActor(first), "search.use")).toBe(true);
    ctx.sqlite
      .prepare("UPDATE permission_entries SET user_id = ?1, group_id = 0 WHERE group_id = ?2")
      .run(first.id, groupId);
    consistent();
    expect(can(ctx, userActor(first), "search.use")).toBe(false);
  });

  for (const table of ["user_groups", "user_group_grants", "shop_group_grants"] as const)
    test(`${table}: a membership moved to another member or another group`, () => {
      const { ctx, first, second, group, definition, consistent } = setup();
      const [holders, others] = [group("Holders"), group("Others")];
      const never = ctx.sqlite.prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES (?1, 0, ?2, 0, -1)",
      );
      never.run(definition("search.use"), holders);
      never.run(definition("profile.view"), others);
      if (table === "user_groups")
        ctx.sqlite
          .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, ?2, 0)")
          .run(first.id, holders);
      else if (table === "user_group_grants") {
        ctx.sqlite.run(
          "INSERT INTO promotions (id, title, group_ids, criteria, created_at, updated_at) VALUES (1, 'P', '[]', '[]', 0, 0)",
        );
        ctx.sqlite
          .prepare(
            "INSERT INTO user_group_grants (user_id, promotion_id, group_id, created_at) VALUES (?1, 1, ?2, 0)",
          )
          .run(first.id, holders);
      } else
        ctx.sqlite
          .prepare(
            "INSERT INTO shop_group_grants (user_id, inventory_id, group_id, created_at) VALUES (?1, 1, ?2, 0)",
          )
          .run(first.id, holders);
      expect(can(ctx, userActor(first), "search.use")).toBe(false);
      ctx.sqlite
        .prepare(`UPDATE ${table} SET user_id = ?1 WHERE user_id = ?2`)
        .run(second.id, first.id);
      consistent();
      expect(can(ctx, userActor(first), "search.use")).toBe(true);
      expect(can(ctx, userActor(second), "search.use")).toBe(false);
      ctx.sqlite
        .prepare(`UPDATE ${table} SET group_id = ?1 WHERE user_id = ?2`)
        .run(others, second.id);
      consistent();
      expect(can(ctx, userActor(second), "search.use")).toBe(true);
      expect(can(ctx, userActor(second), "profile.view", { ownerId: first.id })).toBe(false);
    });

  test("shop_permission_grants: a purchased permission moved to another member", () => {
    const { ctx, first, second, definition, consistent } = setup();
    const quota = () =>
      [first, second].map((user) =>
        permissionValue(ctx, userActor(user), "attachment.storageQuota"),
      );
    const [base] = quota();
    ctx.sqlite
      .prepare(
        "INSERT INTO shop_permission_grants (user_id, inventory_id, permission_id, value, created_at) VALUES (?1, 1, ?2, -1, 0)",
      )
      .run(first.id, definition("attachment.storageQuota"));
    expect(quota()).toEqual([-1, base!]);
    ctx.sqlite
      .prepare("UPDATE shop_permission_grants SET user_id = ?1 WHERE user_id = ?2")
      .run(second.id, first.id);
    consistent();
    expect(quota()).toEqual([base!, -1]);
  });
});
