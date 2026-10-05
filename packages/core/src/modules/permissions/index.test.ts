import { describe, expect, test } from "bun:test";
import {
  createTestContext,
  insertNode,
  insertUser,
  tokenActor,
  userActor,
} from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { invalidate } from "../../context";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from "../../errors";
import { execute } from "../../operation";
import {
  getGlobalPermissions,
  getNodeAccess,
  getNodeTree,
  groupsListOp,
  groupsUpdateOp,
  permissionsListNodeOp,
  permissionsSetNodeOp,
  usersSetGroupOp,
  viewableNodeIds,
} from "./index";

const change = (
  nodeId: number,
  groupId: number,
  canView: boolean | null,
  canPost: boolean | null = null,
  canModerate: boolean | null = null,
) => ({ nodeId, groupId, canView, canPost, canModerate });

describe("permissions", () => {
  test("tree order, ancestors, descendants and cache invalidation", () => {
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

  test("raw inheritance, hidden ancestors, override grants and revocations", async () => {
    const ctx = createTestContext();
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const member = userActor(insertUser(ctx));
    const root = insertNode(ctx, { type: "category" });
    const middle = insertNode(ctx, { parentId: root.id });
    const leaf = insertNode(ctx, { parentId: middle.id });
    invalidate(ctx, "node_tree");
    expect(getNodeAccess(ctx, member)(root.id).post).toBe(true);
    expect(getNodeAccess(ctx, member)(middle.id).post).toBe(true);
    expect(getNodeAccess(ctx, userActor(insertUser(ctx, { groupId: 3 })))(leaf.id).moderate).toBe(
      true,
    );
    await execute(ctx, permissionsSetNodeOp, admin, change(root.id, 2, false, false));
    await execute(ctx, permissionsSetNodeOp, admin, change(middle.id, 2, true, true));
    expect(getNodeAccess(ctx, member)(leaf.id)).toEqual({
      view: false,
      post: false,
      moderate: false,
    });
    await execute(ctx, permissionsSetNodeOp, admin, change(root.id, 2, true, false));
    expect(getNodeAccess(ctx, member)(leaf.id)).toEqual({
      view: true,
      post: true,
      moderate: false,
    });
    expect(getNodeAccess(ctx, admin)(leaf.id)).toEqual({ view: true, post: true, moderate: true });
    expect(viewableNodeIds(ctx, member)).toEqual([root.id, middle.id, leaf.id]);
    expect(getNodeAccess(ctx, GUEST)(leaf.id).post).toBe(false);
    await execute(ctx, permissionsSetNodeOp, admin, change(middle.id, 2, null));
    expect(getNodeAccess(ctx, member)(leaf.id).post).toBe(false);
    expect(
      (await execute(ctx, permissionsListNodeOp, admin, { nodeId: middle.id })).items,
    ).toHaveLength(0);
  });

  test("administrative operations enforce actor and target permissions", async () => {
    const ctx = createTestContext();
    const adminUser = insertUser(ctx, { groupId: 4 });
    const admin = userActor(adminUser);
    const member = userActor(insertUser(ctx));
    const moderator = userActor(insertUser(ctx, { groupId: 3 }));
    const node = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    expect((await execute(ctx, groupsListOp, admin, {})).items).toHaveLength(4);
    expect((await execute(ctx, groupsListOp, tokenActor(adminUser), {})).items).toHaveLength(4);
    await expect(
      execute(ctx, groupsUpdateOp, tokenActor(insertUser(ctx)), { groupId: 2, title: "No" }),
    ).rejects.toThrow(ForbiddenError);
    for (const actor of [member, moderator]) {
      await expect(execute(ctx, groupsListOp, actor, {})).rejects.toThrow(ForbiddenError);
      await expect(
        execute(ctx, groupsUpdateOp, actor, { groupId: 2, title: "No" }),
      ).rejects.toThrow(ForbiddenError);
      await expect(execute(ctx, permissionsListNodeOp, actor, { nodeId: node.id })).rejects.toThrow(
        ForbiddenError,
      );
      await expect(
        execute(ctx, permissionsSetNodeOp, actor, change(node.id, 2, true)),
      ).rejects.toThrow(ForbiddenError);
      await expect(
        execute(ctx, usersSetGroupOp, actor, { userId: adminUser.id, groupId: 2 }),
      ).rejects.toThrow(ForbiddenError);
    }
    await expect(execute(ctx, groupsListOp, GUEST, {})).rejects.toThrow(UnauthenticatedError);
    await expect(execute(ctx, permissionsListNodeOp, GUEST, { nodeId: node.id })).rejects.toThrow(
      UnauthenticatedError,
    );
    await expect(execute(ctx, groupsUpdateOp, GUEST, { groupId: 2, title: "No" })).rejects.toThrow(
      UnauthenticatedError,
    );
    await expect(
      execute(ctx, usersSetGroupOp, GUEST, { userId: adminUser.id, groupId: 2 }),
    ).rejects.toThrow(UnauthenticatedError);
    await expect(
      execute(ctx, permissionsSetNodeOp, GUEST, change(node.id, 2, true)),
    ).rejects.toThrow(UnauthenticatedError);
    await expect(execute(ctx, permissionsListNodeOp, admin, { nodeId: 999 })).rejects.toThrow(
      NotFoundError,
    );
    await expect(
      execute(ctx, permissionsSetNodeOp, admin, change(node.id, 999, true)),
    ).rejects.toThrow(NotFoundError);
    await expect(execute(ctx, permissionsSetNodeOp, admin, change(999, 2, true))).rejects.toThrow(
      NotFoundError,
    );
    await expect(
      execute(ctx, permissionsSetNodeOp, admin, change(node.id, 1, null, true)),
    ).rejects.toThrow(ValidationError);
    await expect(
      execute(ctx, permissionsSetNodeOp, admin, change(node.id, 1, null, null, true)),
    ).rejects.toThrow(ValidationError);
    await execute(ctx, permissionsSetNodeOp, admin, change(node.id, 1, false));
    await execute(ctx, permissionsSetNodeOp, admin, change(node.id, 2, true, null));
    expect((await execute(ctx, permissionsListNodeOp, admin, { nodeId: node.id })).items).toEqual([
      change(node.id, 1, false),
      change(node.id, 2, true),
    ]);
    await expect(execute(ctx, usersSetGroupOp, admin, { userId: 999, groupId: 2 })).rejects.toThrow(
      NotFoundError,
    );
    await expect(
      execute(ctx, usersSetGroupOp, admin, { userId: adminUser.id, groupId: 1 }),
    ).rejects.toThrow(ValidationError);
    await expect(
      execute(ctx, usersSetGroupOp, admin, { userId: adminUser.id, groupId: 999 }),
    ).rejects.toThrow(NotFoundError);
  });

  test("group changes invalidate permissions and retain an administrator", async () => {
    const ctx = createTestContext();
    const adminUser = insertUser(ctx, { groupId: 4 });
    const admin = userActor(adminUser);
    const member = insertUser(ctx);
    expect(getGlobalPermissions(ctx, userActor(member)).canReact).toBe(true);
    const updated = await execute(ctx, groupsUpdateOp, admin, {
      groupId: 2,
      canReact: false,
      title: "Readers",
    });
    expect(updated.title).toBe("Readers");
    expect(getGlobalPermissions(ctx, userActor(member)).canReact).toBe(false);
    await expect(
      execute(ctx, groupsUpdateOp, admin, { groupId: 1, isAdmin: true }),
    ).rejects.toThrow(ValidationError);
    await expect(
      execute(ctx, groupsUpdateOp, admin, { groupId: 1, canPostProfile: true }),
    ).rejects.toThrow(ValidationError);
    await expect(
      execute(ctx, groupsUpdateOp, admin, { groupId: 999, title: "Missing" }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      execute(ctx, groupsUpdateOp, admin, { groupId: 4, isAdmin: false }),
    ).rejects.toThrow(ConflictError);
    await expect(
      execute(ctx, usersSetGroupOp, admin, { userId: adminUser.id, groupId: 2 }),
    ).rejects.toThrow(ConflictError);
    await execute(ctx, usersSetGroupOp, admin, { userId: member.id, groupId: 3 });
    expect(
      ctx.sqlite
        .prepare<{ group_id: number }, [number]>("SELECT group_id FROM users WHERE id = ?1")
        .get(member.id)?.group_id,
    ).toBe(3);
  });

  test("group updates return only contract fields and ignore undefined", async () => {
    const ctx = createTestContext();
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const group = await groupsUpdateOp.run(ctx, admin, { groupId: 2, title: undefined });
    expect(group).toEqual({
      id: 2,
      title: "Member",
      isAdmin: false,
      isModerator: false,
      canViewNodes: true,
      canPost: true,
      canViewProfiles: true,
      canPostProfile: true,
      canStartConversations: true,
      canReact: true,
    });
    expect(Object.keys(group)).not.toContain("groupId");
  });

  test("Guest group rejects every privileged flag", async () => {
    const ctx = createTestContext();
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    for (const flag of [
      "isAdmin",
      "isModerator",
      "canPost",
      "canPostProfile",
      "canStartConversations",
      "canReact",
    ] as const) {
      await expect(
        execute(ctx, groupsUpdateOp, admin, { groupId: 1, [flag]: true }),
      ).rejects.toThrow(ValidationError);
    }
  });

  test("admin demotion succeeds while another administrator remains", async () => {
    const ctx = createTestContext();
    const first = insertUser(ctx, { groupId: 4 });
    const second = insertUser(ctx, { groupId: 4 });
    await execute(ctx, usersSetGroupOp, userActor(second), { userId: first.id, groupId: 2 });
    expect(
      ctx.sqlite
        .prepare<{ group_id: number }, [number]>("SELECT group_id FROM users WHERE id = ?1")
        .get(first.id)?.group_id,
    ).toBe(2);
    const moderator = insertUser(ctx, { groupId: 3 });
    await execute(ctx, groupsUpdateOp, userActor(second), { groupId: 3, isAdmin: true });
    expect(
      (await execute(ctx, groupsUpdateOp, userActor(second), { groupId: 4, isAdmin: false }))
        .isAdmin,
    ).toBe(false);
    expect(getGlobalPermissions(ctx, userActor(moderator)).isAdmin).toBe(true);
  });

  test("Guest restrictions hold even if group flags are forced on", () => {
    const ctx = createTestContext();
    const node = insertNode(ctx, { type: "category" });
    const forum = insertNode(ctx, { parentId: node.id });
    ctx.sqlite.run(
      "UPDATE groups SET is_admin = 1, is_moderator = 1, can_post = 1, can_react = 1 WHERE id = 1",
    );
    invalidate(ctx, "node_tree");
    invalidate(ctx, "permissions");
    expect(getNodeAccess(ctx, GUEST)(forum.id)).toEqual({
      view: true,
      post: false,
      moderate: false,
    });
    expect(getGlobalPermissions(ctx, GUEST).canReact).toBe(false);
  });
});
