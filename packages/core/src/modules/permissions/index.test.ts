import { describe, expect, test } from "bun:test";
import {
  createTestContext,
  expectNoTableScan,
  insertNode,
  insertUser,
  tokenActor,
  userActor,
} from "@sermo/core/testing";
import { type Actor, GUEST } from "../../actor";
import { invalidate } from "../../context";
import { GROUP_IDS } from "../../db/schema";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from "../../errors";
import { execute } from "../../operation";
import { can } from "../../permissions";
import {
  getGlobalPermissions,
  getNodeAccess,
  getNodeTree,
  groupsCreateOp,
  groupsDeleteOp,
  groupsGetOp,
  groupsListOp,
  groupsUpdateOp,
  permissionsDefinitionsOp,
  permissionsExplainOp,
  permissionsListNodeOp,
  permissionsListOp,
  permissionsSetOp,
  usersGetGroupsOp,
  usersSetGroupsOp,
  viewableNodeIds,
} from "./index";

const entry = (permission: string, value: "allow" | "no" | "never" | "unset" | number) => ({
  permission,
  value,
});
const set = (
  groupId: number,
  permission: string,
  value: "allow" | "no" | "never" | "unset" | number,
  nodeId?: number,
) => ({ groupId, nodeId, entries: [entry(permission, value)] });

describe("permissions administration", () => {
  test("tree order, ancestors, subtree and cache invalidation", () => {
    const ctx = createTestContext();
    const root = insertNode(ctx, { title: "Root", type: "category", position: 1 });
    const child = insertNode(ctx, { title: "Child", parentId: root.id, position: 2 });
    const leaf = insertNode(ctx, { title: "Leaf", parentId: child.id, position: 1 });
    expect(getNodeTree(ctx).entries.map((n) => n.id)).toEqual([root.id, child.id, leaf.id]);
    expect(
      getNodeTree(ctx)
        .ancestors(leaf.id)
        .map((n) => n.id),
    ).toEqual([root.id, child.id]);
    expect(getNodeTree(ctx).subtreeIds(child.id)).toEqual([child.id, leaf.id]);
    const next = insertNode(ctx, { title: "New", parentId: root.id, position: 1 });
    invalidate(ctx, "node_tree");
    expect(getNodeTree(ctx).entries.map((n) => n.id)).toEqual([
      root.id,
      next.id,
      child.id,
      leaf.id,
    ]);
    expect(getNodeAccess(ctx, GUEST)(next.id).view).toBe(true);
  });

  test("node inheritance, hidden ancestors, overrides and revocation", async () => {
    const ctx = createTestContext();
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const member = userActor(insertUser(ctx));
    const root = insertNode(ctx, { type: "category" });
    const middle = insertNode(ctx, { parentId: root.id });
    const leaf = insertNode(ctx, { parentId: middle.id });
    invalidate(ctx, "node_tree");
    expect(getNodeAccess(ctx, member)(root.id).post).toBe(true);
    expect(getNodeAccess(ctx, userActor(insertUser(ctx, { groupId: 3 })))(leaf.id).moderate).toBe(
      true,
    );
    await execute(ctx, permissionsSetOp, admin, set(2, "node.view", "no", root.id));
    await execute(ctx, permissionsSetOp, admin, set(2, "node.view", "allow", middle.id));
    expect(getNodeAccess(ctx, member)(leaf.id).view).toBe(false);
    await execute(ctx, permissionsSetOp, admin, set(2, "node.view", "allow", root.id));
    expect(getNodeAccess(ctx, member)(leaf.id).post).toBe(true);
    expect(getNodeAccess(ctx, admin)(leaf.id)).toEqual({
      view: true,
      post: true,
      moderate: true,
    });
    expect(viewableNodeIds(ctx, member)).toEqual([root.id, middle.id, leaf.id]);
    await execute(ctx, permissionsSetOp, admin, set(2, "node.view", "unset", middle.id));
    expect((await execute(ctx, permissionsListNodeOp, admin, { nodeId: middle.id })).items).toEqual(
      [],
    );
    expect(getNodeAccess(ctx, GUEST)(leaf.id).post).toBe(false);
  });

  test("group CRUD, ranks, authorization and token actors", async () => {
    const ctx = createTestContext();
    const adminUser = insertUser(ctx, { groupId: 4 });
    const admin = userActor(adminUser);
    const member = userActor(insertUser(ctx));
    expect((await execute(ctx, groupsListOp, tokenActor(adminUser), {})).items).toHaveLength(5);
    expect((await execute(ctx, groupsListOp, admin, {})).items.map((g) => g.rank)).toEqual([
      100, 50, 10, 1, 0,
    ]);
    await expect(execute(ctx, groupsListOp, member, {})).rejects.toThrow(ForbiddenError);
    await expect(execute(ctx, groupsListOp, GUEST, {})).rejects.toThrow(UnauthenticatedError);
    await expect(
      execute(ctx, groupsCreateOp, admin, { title: "Equal", rank: 100 }),
    ).rejects.toThrow(ForbiddenError);
    const group = await execute(ctx, groupsCreateOp, admin, { title: "Helpers", rank: 20 });
    expect(group.builtin).toBeNull();
    expect((await execute(ctx, groupsGetOp, admin, { groupId: group.id })).title).toBe("Helpers");
    expect(
      (await execute(ctx, groupsUpdateOp, admin, { groupId: group.id, badge: "helper" })).badge,
    ).toBe("helper");
    await expect(execute(ctx, groupsUpdateOp, admin, { groupId: 4, title: "No" })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(
      execute(ctx, groupsUpdateOp, admin, { groupId: group.id, rank: 100 }),
    ).rejects.toThrow(ForbiddenError);
    await expect(execute(ctx, groupsDeleteOp, admin, { groupId: 2 })).rejects.toThrow(
      ConflictError,
    );
    await expect(execute(ctx, groupsGetOp, admin, { groupId: 999 })).rejects.toThrow(NotFoundError);
    expect(await execute(ctx, groupsDeleteOp, admin, { groupId: group.id })).toEqual({ ok: true });
    expect(
      ctx.sqlite
        .prepare<{ action: string }, []>(
          "SELECT action FROM moderator_log WHERE target_type = 'group' ORDER BY id",
        )
        .all()
        .map((row) => row.action),
    ).toEqual(["group.create", "group.update", "group.delete"]);
  });

  test("member groups, hierarchy, promotion grants and last administrator", async () => {
    const ctx = createTestContext();
    const first = insertUser(ctx, { groupId: 4 });
    const second = insertUser(ctx, { groupId: 4 });
    const member = insertUser(ctx);
    const actor = userActor(first);
    const group = await execute(ctx, groupsCreateOp, actor, { title: "Helpers", rank: 20 });
    await expect(
      execute(ctx, usersSetGroupsOp, actor, { userId: first.id, primaryGroupId: 2 }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      execute(ctx, usersSetGroupsOp, actor, { userId: member.id, primaryGroupId: 1 }),
    ).rejects.toThrow(ValidationError);
    await expect(
      execute(ctx, usersSetGroupsOp, actor, { userId: member.id, secondaryGroupIds: [1] }),
    ).rejects.toThrow(ValidationError);
    await expect(
      execute(ctx, usersSetGroupsOp, actor, { userId: member.id, secondaryGroupIds: [4] }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      execute(ctx, usersSetGroupsOp, actor, { userId: 999, primaryGroupId: 2 }),
    ).rejects.toThrow(NotFoundError);
    const changed = await execute(ctx, usersSetGroupsOp, actor, {
      userId: member.id,
      primaryGroupId: group.id,
      secondaryGroupIds: [2, group.id],
    });
    expect(changed.secondaryGroupIds).toEqual([2, group.id]);
    expect(changed.displayGroupId).toBe(group.id);
    expect(
      ctx.sqlite
        .prepare<{ action: string }, []>(
          "SELECT action FROM moderator_log ORDER BY id DESC LIMIT 1",
        )
        .get()!.action,
    ).toBe("user.groups");
    expect(
      (await execute(ctx, usersGetGroupsOp, actor, { userId: member.id })).promotionGroupIds,
    ).toEqual([]);
    await expect(
      execute(ctx, usersGetGroupsOp, userActor(member), { userId: first.id }),
    ).rejects.toThrow(ForbiddenError);
    await expect(execute(ctx, usersGetGroupsOp, GUEST, { userId: member.id })).rejects.toThrow(
      UnauthenticatedError,
    );
    ctx.sqlite
      .prepare(
        "INSERT INTO promotions (title, group_ids, criteria, created_at, updated_at) VALUES ('P', ?1, '[]', 0, 0)",
      )
      .run(JSON.stringify([group.id]));
    const promotionId = Number(
      ctx.sqlite
        .query<{ id: number }, []>("SELECT id FROM promotions ORDER BY id DESC LIMIT 1")
        .get()!.id,
    );
    ctx.sqlite
      .prepare(
        "INSERT INTO user_group_grants (user_id, promotion_id, group_id, created_at) VALUES (?1, ?2, ?3, 0)",
      )
      .run(member.id, promotionId, group.id);
    expect(
      (await execute(ctx, usersGetGroupsOp, actor, { userId: member.id })).promotionGroupIds,
    ).toEqual([group.id]);
    await execute(ctx, permissionsSetOp, actor, set(group.id, "profile.view", "allow"));
    await execute(ctx, groupsDeleteOp, actor, { groupId: group.id });
    expect(
      (await execute(ctx, usersGetGroupsOp, actor, { userId: member.id })).primaryGroupId,
    ).toBe(2);
    expect(
      ctx.sqlite
        .prepare<{ id: number }, [number]>("SELECT id FROM user_groups WHERE group_id = ?1")
        .get(group.id),
    ).toBeNull();
    expect(
      ctx.sqlite
        .prepare<{ id: number }, [number]>("SELECT id FROM permission_entries WHERE group_id = ?1")
        .get(group.id),
    ).toBeNull();
    expect(
      ctx.sqlite
        .prepare<{ group_ids: string }, []>("SELECT group_ids FROM promotions WHERE id = 1")
        .get()!.group_ids,
    ).toBe("[]");
    await execute(ctx, permissionsSetOp, actor, {
      userId: second.id,
      entries: [entry("admin.permissions", "never")],
    });
    await expect(
      execute(ctx, permissionsSetOp, actor, {
        userId: first.id,
        entries: [entry("admin.permissions", "never")],
      }),
    ).rejects.toThrow(ConflictError);
  });

  test("registry definitions, entries, explain, guest limits and query plans", async () => {
    const ctx = createTestContext();
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const member = insertUser(ctx);
    const node = insertNode(ctx, {});
    const definitions = await execute(ctx, permissionsDefinitionsOp, admin, {});
    expect(
      definitions.items.some(
        (d) => d.id === "admin.permissions" && d.label === "permission.admin.permissions",
      ),
    ).toBe(true);
    await expect(execute(ctx, permissionsDefinitionsOp, GUEST, {})).rejects.toThrow(
      UnauthenticatedError,
    );
    await expect(
      execute(ctx, permissionsListOp, userActor(member), { groupId: 2 }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      execute(ctx, permissionsSetOp, admin, set(1, "forum.reply", "allow", node.id)),
    ).rejects.toThrow(ValidationError);
    await expect(
      execute(ctx, permissionsSetOp, admin, set(2, "admin.groups", "allow", node.id)),
    ).rejects.toThrow(ValidationError);
    await expect(
      execute(ctx, permissionsSetOp, admin, set(2, "forum.reply", "no")),
    ).rejects.toThrow(ValidationError);
    await expect(execute(ctx, permissionsSetOp, admin, set(2, "missing", "allow"))).rejects.toThrow(
      ValidationError,
    );
    await expect(
      execute(ctx, permissionsSetOp, admin, set(2, "forum.reply", 3, node.id)),
    ).rejects.toThrow(ValidationError);
    await expect(
      execute(ctx, permissionsSetOp, admin, set(2, "attachment.storageQuota", "allow")),
    ).rejects.toThrow(ValidationError);
    await expect(
      execute(ctx, permissionsSetOp, admin, {
        groupId: 2,
        userId: member.id,
        entries: [entry("profile.view", "allow")],
      }),
    ).rejects.toThrow(ValidationError);
    await expect(
      execute(ctx, permissionsSetOp, admin, { entries: [entry("profile.view", "allow")] }),
    ).rejects.toThrow(ValidationError);
    await expect(
      execute(ctx, permissionsSetOp, admin, {
        userId: 999,
        entries: [entry("profile.view", "allow")],
      }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      execute(ctx, permissionsSetOp, admin, set(2, "forum.reply", "allow", 999)),
    ).rejects.toThrow(NotFoundError);
    await execute(ctx, permissionsSetOp, admin, set(2, "attachment.storageQuota", 123));
    expect(
      (
        await execute(ctx, permissionsExplainOp, admin, {
          userId: member.id,
          permission: "attachment.storageQuota",
        })
      ).value,
    ).toBe(123);
    await expect(
      execute(ctx, permissionsSetOp, admin, set(999, "forum.reply", "allow", node.id)),
    ).rejects.toThrow(NotFoundError);
    const result = await execute(
      ctx,
      permissionsSetOp,
      admin,
      set(2, "forum.reply", "never", node.id),
    );
    expect(result.entries).toContainEqual({ permission: "forum.reply", value: "never" });
    const log = ctx.sqlite
      .prepare<{ action: string; details: string }, []>(
        "SELECT action, details FROM moderator_log ORDER BY id DESC LIMIT 1",
      )
      .get()!;
    expect(log.action).toBe("permission.set");
    expect(JSON.parse(log.details).entries).toEqual([entry("forum.reply", "never")]);
    expect(
      (await execute(ctx, permissionsListOp, admin, { groupId: 2, nodeId: node.id })).entries,
    ).toContainEqual({ permission: "forum.reply", value: "never" });
    expect(
      can(ctx, userActor(member), "forum.reply", { nodeId: node.id, threadBanned: false }),
    ).toBe(false);
    const explanation = await execute(ctx, permissionsExplainOp, admin, {
      userId: member.id,
      permission: "forum.reply",
      nodeId: node.id,
      threadBanned: false,
    });
    expect(explanation.layers.some((l) => l.groupId === 2 && l.value === "never")).toBe(true);
    await execute(ctx, permissionsSetOp, admin, set(2, "forum.editOwnTimeLimit", 1, node.id));
    expect(
      (
        await execute(ctx, permissionsExplainOp, admin, {
          userId: member.id,
          permission: "forum.editOwn",
          nodeId: node.id,
          ownerId: member.id,
          createdAt: new Date(ctx.now() - 120_000).toISOString(),
        })
      ).deniedBy,
    ).toBe("timeLimit");
    expect(
      (
        await execute(ctx, permissionsExplainOp, admin, {
          userId: null,
          permission: "node.view",
          nodeId: node.id,
        })
      ).granted,
    ).toBe(true);
    await expect(
      execute(ctx, permissionsExplainOp, admin, {
        userId: null,
        permission: "forum.reply",
        nodeId: node.id,
      }),
    ).rejects.toThrow(ValidationError);
    await expect(
      execute(ctx, permissionsExplainOp, admin, {
        userId: 999,
        permission: "node.view",
        nodeId: node.id,
      }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      execute(ctx, permissionsExplainOp, admin, { userId: null, permission: "missing" }),
    ).rejects.toThrow(ValidationError);
    await execute(ctx, permissionsSetOp, admin, set(2, "forum.reply", "unset", node.id));
    await execute(ctx, permissionsSetOp, admin, set(2, "forum.editOwnTimeLimit", "unset", node.id));
    expect((await execute(ctx, permissionsListNodeOp, admin, { nodeId: node.id })).items).toEqual(
      [],
    );
    expectNoTableScan(
      ctx,
      "SELECT id FROM users WHERE permission_combination_id IN (SELECT value FROM json_each(?1)) AND banned_permanently = 0 AND (banned_until IS NULL OR banned_until <= ?2) LIMIT 1",
      ["[1]", ctx.now()],
    );
    expectNoTableScan(
      ctx,
      "SELECT e.group_id, e.user_id, e.node_id, d.key AS permission, e.value, d.value_type AS type FROM permission_entries e JOIN permission_definitions d ON d.id = e.permission_id WHERE e.node_id = ?1",
      [node.id],
    );
    expect(getGlobalPermissions(ctx, GUEST).canReact).toBe(false);
  });

  test("custom grants separate group administration from permission administration", async () => {
    const ctx = createTestContext();
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const member = insertUser(ctx);
    const custom = await execute(ctx, groupsCreateOp, admin, { title: "Group managers", rank: 20 });
    await execute(ctx, permissionsSetOp, admin, set(custom.id, "admin.groups", "allow"));
    await execute(ctx, usersSetGroupsOp, admin, {
      userId: member.id,
      secondaryGroupIds: [custom.id],
    });
    expect((await execute(ctx, groupsListOp, userActor(member), {})).items).toHaveLength(6);
    await expect(execute(ctx, permissionsDefinitionsOp, userActor(member), {})).rejects.toThrow(
      ForbiddenError,
    );
    await execute(ctx, permissionsSetOp, admin, set(custom.id, "admin.groups", "never"));
    await expect(execute(ctx, groupsListOp, userActor(member), {})).rejects.toThrow(ForbiddenError);
  });

  test("guests stay restricted when account-only entries are forced on", () => {
    const ctx = createTestContext();
    const node = insertNode(ctx, {});
    const definition = ctx.sqlite.prepare<{ id: number }, [string]>(
      "SELECT id FROM permission_definitions WHERE key = ?1",
    );
    const insert = ctx.sqlite.prepare(
      "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES (?1, ?2, ?3, 0, 1)",
    );
    insert.run(definition.get("forum.reply")!.id, node.id, GROUP_IDS.guest);
    insert.run(definition.get("reaction.react")!.id, 0, GROUP_IDS.guest);
    expect(can(ctx, GUEST, "forum.reply", { nodeId: node.id, threadBanned: false })).toBe(false);
    expect(can(ctx, GUEST, "reaction.react")).toBe(false);
  });

  test("moderators and non-admin tokens are forbidden every admin operation", async () => {
    const ctx = createTestContext();
    const moderator = userActor(insertUser(ctx, { groupId: 3 }));
    const token = tokenActor(insertUser(ctx));
    const attempts = (actor: Actor) => [
      () => execute(ctx, groupsListOp, actor, {}),
      () => execute(ctx, groupsGetOp, actor, { groupId: 999 }),
      () => execute(ctx, groupsCreateOp, actor, { title: "No", rank: 10 }),
      () => execute(ctx, groupsUpdateOp, actor, { groupId: 999, title: "No" }),
      () => execute(ctx, groupsDeleteOp, actor, { groupId: 999 }),
      () => execute(ctx, usersGetGroupsOp, actor, { userId: 999 }),
      () => execute(ctx, usersSetGroupsOp, actor, { userId: 999, primaryGroupId: 2 }),
      () => execute(ctx, permissionsDefinitionsOp, actor, {}),
      () => execute(ctx, permissionsListOp, actor, { groupId: 2 }),
      () => execute(ctx, permissionsSetOp, actor, set(2, "profile.view", "allow")),
      () => execute(ctx, permissionsListNodeOp, actor, { nodeId: 999 }),
      () => execute(ctx, permissionsExplainOp, actor, { userId: null, permission: "profile.view" }),
    ];
    for (const actor of [moderator, token])
      for (const attempt of attempts(actor))
        await expect(attempt()).rejects.toThrow(ForbiddenError);
    await expect(execute(ctx, groupsUpdateOp, GUEST, { groupId: 2, title: "No" })).rejects.toThrow(
      UnauthenticatedError,
    );
    await expect(
      execute(ctx, permissionsSetOp, GUEST, set(2, "profile.view", "allow")),
    ).rejects.toThrow(UnauthenticatedError);
    await expect(execute(ctx, permissionsListNodeOp, GUEST, { nodeId: 999 })).rejects.toThrow(
      UnauthenticatedError,
    );
    await expect(
      execute(ctx, usersSetGroupsOp, GUEST, { userId: 999, primaryGroupId: 2 }),
    ).rejects.toThrow(UnauthenticatedError);
  });

  test("member administration denies before target lookup", async () => {
    const ctx = createTestContext();
    const member = userActor(insertUser(ctx));
    await expect(execute(ctx, usersGetGroupsOp, member, { userId: 999 })).rejects.toThrow(
      ForbiddenError,
    );
    await expect(
      execute(ctx, usersSetGroupsOp, member, { userId: 999, primaryGroupId: 2 }),
    ).rejects.toThrow(ForbiddenError);
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    await expect(execute(ctx, usersGetGroupsOp, admin, { userId: 999 })).rejects.toThrow(
      NotFoundError,
    );
    await expect(
      execute(ctx, usersSetGroupsOp, admin, { userId: 999, primaryGroupId: 2 }),
    ).rejects.toThrow(NotFoundError);
  });

  test("group and membership changes retain the last permission administrator", async () => {
    const ctx = createTestContext();
    const founder = insertUser(ctx, { groupId: 4 });
    const founderActor = userActor(founder);
    const managerGroup = await execute(ctx, groupsCreateOp, founderActor, {
      title: "Managers",
      rank: 50,
    });
    const adminGroup = await execute(ctx, groupsCreateOp, founderActor, {
      title: "Limited admins",
      rank: 20,
    });
    await execute(ctx, permissionsSetOp, founderActor, {
      groupId: managerGroup.id,
      entries: [entry("admin.members", "allow"), entry("admin.groups", "allow")],
    });
    await execute(
      ctx,
      permissionsSetOp,
      founderActor,
      set(adminGroup.id, "admin.permissions", "allow"),
    );
    const manager = insertUser(ctx, { groupId: managerGroup.id });
    const holder = insertUser(ctx, { groupId: adminGroup.id });
    ctx.sqlite.prepare("UPDATE users SET group_id = 2 WHERE id = ?1").run(founder.id);
    await expect(
      execute(ctx, usersSetGroupsOp, userActor(manager), { userId: holder.id, primaryGroupId: 2 }),
    ).rejects.toThrow(ConflictError);
    await expect(
      execute(ctx, groupsDeleteOp, userActor(manager), { groupId: adminGroup.id }),
    ).rejects.toThrow(ConflictError);
    expect(
      (await execute(ctx, groupsGetOp, userActor(manager), { groupId: adminGroup.id })).id,
    ).toBe(adminGroup.id);
  });

  test("banned administrators do not satisfy the last-administrator guard", async () => {
    const ctx = createTestContext();
    const healthy = insertUser(ctx, { groupId: 4 });
    const permanent = insertUser(ctx, { groupId: 4 });
    const temporary = insertUser(ctx, { groupId: 4 });
    ctx.sqlite.prepare("UPDATE users SET banned_permanently = 1 WHERE id = ?1").run(permanent.id);
    ctx.sqlite
      .prepare("UPDATE users SET banned_until = ?1 WHERE id = ?2")
      .run(ctx.now() + 60_000, temporary.id);
    await expect(
      execute(ctx, permissionsSetOp, userActor(healthy), {
        userId: healthy.id,
        entries: [entry("admin.permissions", "never")],
      }),
    ).rejects.toThrow(ConflictError);
    await execute(ctx, permissionsSetOp, userActor(healthy), set(2, "profile.view", "allow"));
  });
});
