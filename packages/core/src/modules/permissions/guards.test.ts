import { describe, expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { ConflictError, ForbiddenError } from "../../errors";
import { execute } from "../../operation";
import { can, combinationsGranting, memberStanding } from "../../permissions";
import { resolvedActor, sharedDatabase } from "../../permissions/test-contexts";
import {
  groupsCreateOp,
  groupsDeleteOp,
  permissionsExplainOp,
  permissionsSetOp,
  usersSetGroupsOp,
} from "./index";

const allow = (permission: string) => ({ permission, value: "allow" as const });

describe("deleting a group", () => {
  async function scenario() {
    const ctx = createTestContext();
    const founder = userActor(insertUser(ctx, { groupId: 4 }));
    const low = await execute(ctx, groupsCreateOp, founder, { title: "Low", rank: 1 });
    const managers = await execute(ctx, groupsCreateOp, founder, { title: "Managers", rank: 5 });
    await execute(ctx, permissionsSetOp, founder, {
      groupId: managers.id,
      entries: [allow("admin.groups")],
    });
    const manager = insertUser(ctx, { groupId: low.id });
    await execute(ctx, usersSetGroupsOp, founder, {
      userId: manager.id,
      secondaryGroupIds: [managers.id],
    });
    return { ctx, founder, low, manager };
  }

  test("cannot move its members to a group ranked at or above the deleter", async () => {
    const { ctx, founder, low, manager } = await scenario();
    const actor = userActor(manager);
    expect(memberStanding(ctx, actor).maxRank).toBe(5);
    await expect(execute(ctx, groupsDeleteOp, actor, { groupId: low.id })).rejects.toThrow(
      ForbiddenError,
    );
    expect(memberStanding(ctx, userActor(manager)).maxRank).toBe(5);
    // Someone who outranks the Member group may.
    expect(await execute(ctx, groupsDeleteOp, founder, { groupId: low.id })).toEqual({ ok: true });
    expect(memberStanding(ctx, userActor({ ...manager, groupId: 2 })).maxRank).toBe(10);
  });

  test("is allowed below the Member group when nobody has it as primary group", async () => {
    const { ctx, founder, manager } = await scenario();
    const empty = await execute(ctx, groupsCreateOp, founder, { title: "Empty", rank: 2 });
    // Secondary members are not reassigned, so they do not count.
    await execute(ctx, usersSetGroupsOp, founder, {
      userId: insertUser(ctx).id,
      secondaryGroupIds: [empty.id],
    });
    expect(await execute(ctx, groupsDeleteOp, userActor(manager), { groupId: empty.id })).toEqual({
      ok: true,
    });
  });
});

describe("the last-administrator guard", () => {
  test("counts an administrator whose combination another process created", async () => {
    const fixture = createTestContext();
    const founder = insertUser(fixture, { groupId: 4 });
    const database = sharedDatabase(fixture);
    try {
      const here = database.open();
      const elsewhere = database.open();
      const actor = resolvedActor(here, founder.id);
      expect(combinationsGranting(here, "admin.permissions")).toHaveLength(1);
      // Membership changes create combinations without moving the permissions version.
      const second = insertUser(elsewhere, { groupId: 4 });
      const other = insertUser(elsewhere);
      const join = elsewhere.sqlite.prepare(
        "INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, ?2, 0)",
      );
      join.run(second.id, 2);
      join.run(other.id, 3);
      // Resolving the newer combination first must not hide the older one.
      expect(can(here, resolvedActor(here, other.id), "admin.permissions")).toBe(false);
      await execute(here, permissionsSetOp, actor, {
        userId: founder.id,
        entries: [{ permission: "admin.permissions", value: "never" }],
      });
      expect(can(elsewhere, resolvedActor(elsewhere, second.id), "admin.permissions")).toBe(true);
      await expect(
        execute(elsewhere, permissionsSetOp, resolvedActor(elsewhere, second.id), {
          userId: second.id,
          entries: [{ permission: "admin.permissions", value: "never" }],
        }),
      ).rejects.toThrow(ConflictError);
    } finally {
      database.close();
    }
  });
});

describe("permissions.explain", () => {
  test("names the ban that zeroes an integer permission", async () => {
    const ctx = createTestContext();
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const member = insertUser(ctx);
    const explain = () =>
      execute(ctx, permissionsExplainOp, admin, {
        userId: member.id,
        permission: "attachment.storageQuota",
      });
    const before = await explain();
    expect(before.deniedBy).toBeNull();
    expect(before.granted).toBe(true);
    ctx.sqlite.prepare("UPDATE users SET banned_permanently = 1 WHERE id = ?1").run(member.id);
    expect(await explain()).toMatchObject({ granted: false, value: 0, deniedBy: "banned" });
  });
});
