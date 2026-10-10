import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Actor } from "../actor";
import { type Ctx, closeContext, createContext, invalidate } from "../context";
import { GROUP_IDS, RESTRICTION_PERMANENT } from "../db/schema";
import { createTestContext, insertNode, insertUser, type TestClock, userActor } from "../testing";
import {
  can,
  combinationsGranting,
  explainPermission,
  memberActor,
  memberStanding,
  PERMISSION_IDS,
  PERMISSIONS,
  type PermissionDefinition,
  type PermissionId,
  PRINCIPAL_COLUMNS,
  type PrincipalRow,
  permissionState,
  permissionsOf,
  permissionValue,
  requirePermission,
  resolvedPermissions,
  syncPermissionRegistry,
  viewableNodeIds,
} from ".";
import { currentVersions } from "./state";

type TestCtx = Ctx & { clock: TestClock };
type Value = "allow" | "no" | "never" | number;
const encode = (v: Value) => (v === "allow" ? 1 : v === "no" ? 0 : v === "never" ? -1 : v);

function setEntry(
  ctx: Ctx,
  target: { groupId?: number; userId?: number },
  permission: PermissionId,
  value: Value | null,
  nodeId = 0,
) {
  const definition = ctx.sqlite
    .prepare<{ id: number }, [string]>("SELECT id FROM permission_definitions WHERE key = ?1")
    .get(permission)!.id;
  const groupId = target.groupId ?? 0;
  const userId = target.userId ?? 0;
  ctx.sqlite
    .prepare(
      "DELETE FROM permission_entries WHERE permission_id = ?1 AND node_id = ?2 AND group_id = ?3 AND user_id = ?4",
    )
    .run(definition, nodeId, groupId, userId);
  if (value !== null)
    ctx.sqlite
      .prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES (?1, ?2, ?3, ?4, ?5)",
      )
      .run(definition, nodeId, groupId, userId, encode(value));
}

function createGroup(ctx: Ctx, title: string, rank = 10): number {
  return ctx.sqlite
    .prepare<{ id: number }, [string, number]>(
      "INSERT INTO groups (title, rank) VALUES (?1, ?2) RETURNING id",
    )
    .get(title, rank)!.id;
}

function addToGroup(ctx: Ctx, userId: number, groupId: number) {
  ctx.sqlite
    .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, ?2, 0)")
    .run(userId, groupId);
}

/** A member whose only group is `primary` (a fresh custom group by default), plus `extra`. */
function member(ctx: Ctx, primary: number, ...extra: number[]): Actor {
  const user = insertUser(ctx, { groupId: primary });
  for (const groupId of extra) addToGroup(ctx, user.id, groupId);
  return userActor(user);
}

/** Forum tree: root > parent > (child > grandchild, sibling). */
function tree(ctx: TestCtx) {
  const root = insertNode(ctx, { type: "category" }).id;
  const parent = insertNode(ctx, { parentId: root }).id;
  const child = insertNode(ctx, { parentId: parent }).id;
  const grandchild = insertNode(ctx, { parentId: child }).id;
  const sibling = insertNode(ctx, { parentId: parent }).id;
  invalidate(ctx, "node_tree");
  return { root, parent, child, grandchild, sibling };
}

describe("permission resolution", () => {
  test("across groups: any never denies, otherwise any allow grants, otherwise denied", () => {
    const ctx = createTestContext();
    const cases: [Value | null, Value | null, boolean][] = [
      ["allow", null, true],
      [null, null, false],
      ["allow", "allow", true],
      ["allow", "never", false],
      ["never", "allow", false],
      ["never", null, false],
    ];
    for (const [a, b, expected] of cases) {
      const groupA = createGroup(ctx, "A");
      const groupB = createGroup(ctx, "B");
      setEntry(ctx, { groupId: groupA }, "search.use", a);
      setEntry(ctx, { groupId: groupB }, "search.use", b);
      // Rank is display and hierarchy only: a high-ranked never still denies, and the reverse.
      ctx.sqlite.prepare("UPDATE groups SET rank = ?1 WHERE id = ?2").run(90, groupA);
      expect(can(ctx, member(ctx, groupA, groupB), "search.use")).toBe(expected);
    }
  });

  test("on nodes the nearest entry wins per group, and 'no' clears an inherited allow for that group only", () => {
    const ctx = createTestContext();
    const n = tree(ctx);
    const a = createGroup(ctx, "A");
    const b = createGroup(ctx, "B");
    setEntry(ctx, { groupId: a }, "node.view", "allow");
    setEntry(ctx, { groupId: b }, "node.view", "allow");
    setEntry(ctx, { groupId: a }, "forum.createThread", "allow");
    setEntry(ctx, { groupId: a }, "forum.createThread", "no", n.parent);
    setEntry(ctx, { groupId: a }, "forum.createThread", "allow", n.child);
    const onlyA = member(ctx, a);
    const post = (actor: Actor, nodeId: number) =>
      can(ctx, actor, "forum.createThread", { nodeId });
    const table: [number, boolean][] = [
      [n.root, true],
      [n.parent, false],
      [n.sibling, false],
      [n.child, true],
      [n.grandchild, true],
    ];
    for (const [nodeId, expected] of table) expect(post(onlyA, nodeId)).toBe(expected);

    // 'no' does not block another group's allow; 'never' does.
    setEntry(ctx, { groupId: b }, "forum.createThread", "allow");
    const both = member(ctx, a, b);
    expect(post(both, n.parent)).toBe(true);
    expect(post(both, n.sibling)).toBe(true);
    setEntry(ctx, { groupId: a }, "forum.createThread", "never", n.parent);
    const bothAfter = member(ctx, a, b);
    expect(post(bothAfter, n.parent)).toBe(false);
    expect(post(bothAfter, n.sibling)).toBe(false);
    // The nearer allow on the child still wins for group A below the never on the parent.
    expect(post(bothAfter, n.child)).toBe(true);
  });

  test("nothing in a node is permitted without view, and a node needs its ancestors' view", () => {
    const ctx = createTestContext();
    const n = tree(ctx);
    const a = createGroup(ctx, "A");
    setEntry(ctx, { groupId: a }, "node.view", "allow");
    setEntry(ctx, { groupId: a }, "forum.createThread", "allow");
    setEntry(ctx, { groupId: a }, "node.view", "no", n.parent);
    setEntry(ctx, { groupId: a }, "node.view", "allow", n.child);
    const actor = member(ctx, a);
    expect(can(ctx, actor, "node.view", { nodeId: n.root })).toBe(true);
    expect(can(ctx, actor, "node.view", { nodeId: n.parent })).toBe(false);
    expect(can(ctx, actor, "node.view", { nodeId: n.child })).toBe(false);
    expect(can(ctx, actor, "forum.createThread", { nodeId: n.child })).toBe(false);
    expect(viewableNodeIds(ctx, actor)).toEqual([n.root]);
  });

  test("integer permissions take the highest value, with -1 as unlimited", () => {
    const ctx = createTestContext();
    const n = tree(ctx);
    const cases: [Value | null, Value | null, number][] = [
      [100, 500, 500],
      [500, null, 500],
      [100, -1, -1],
      [null, null, 0],
      [0, 7, 7],
    ];
    for (const [a, b, expected] of cases) {
      const groupA = createGroup(ctx, "A");
      const groupB = createGroup(ctx, "B");
      setEntry(ctx, { groupId: groupA }, "attachment.storageQuota", a);
      setEntry(ctx, { groupId: groupB }, "attachment.storageQuota", b);
      expect(permissionValue(ctx, member(ctx, groupA, groupB), "attachment.storageQuota")).toBe(
        expected,
      );
    }
    // Node-scoped: nearest entry per group, then the highest across groups.
    const a = createGroup(ctx, "A");
    const b = createGroup(ctx, "B");
    setEntry(ctx, { groupId: a }, "node.view", "allow");
    setEntry(ctx, { groupId: a }, "forum.editOwnTimeLimit", 60);
    setEntry(ctx, { groupId: a }, "forum.editOwnTimeLimit", 10, n.parent);
    setEntry(ctx, { groupId: b }, "forum.editOwnTimeLimit", 30);
    expect(
      permissionValue(ctx, member(ctx, a), "forum.editOwnTimeLimit", { nodeId: n.child }),
    ).toBe(10);
    expect(
      permissionValue(ctx, member(ctx, a, b), "forum.editOwnTimeLimit", { nodeId: n.child }),
    ).toBe(30);
    expect(
      permissionValue(ctx, member(ctx, a, b), "forum.editOwnTimeLimit", { nodeId: n.root }),
    ).toBe(60);
  });

  test("member-specific entries apply to that member only, through a private combination", () => {
    const ctx = createTestContext();
    const n = tree(ctx);
    const moderator = insertUser(ctx);
    const other = insertUser(ctx);
    setEntry(ctx, { userId: moderator.id }, "forum.deleteAny", "allow", n.parent);
    const actor = userActor(moderator);
    expect(can(ctx, actor, "forum.deleteAny", { nodeId: n.child })).toBe(true);
    expect(can(ctx, actor, "forum.deleteAny", { nodeId: n.root })).toBe(false);
    expect(can(ctx, userActor(other), "forum.deleteAny", { nodeId: n.child })).toBe(false);
    const combination = (userId: number) =>
      ctx.sqlite
        .prepare<{ user_id: number; group_ids: string }, [number]>(
          "SELECT c.user_id, c.group_ids FROM users u JOIN permission_combinations c ON c.id = u.permission_combination_id WHERE u.id = ?1",
        )
        .get(userId);
    expect(combination(moderator.id)).toEqual({ user_id: moderator.id, group_ids: "2" });
    expect(combination(other.id)).toEqual({ user_id: 0, group_ids: "2" });
    // A member-specific never beats the member's groups.
    setEntry(ctx, { userId: other.id }, "search.use", "never");
    expect(can(ctx, userActor(other), "search.use")).toBe(false);
    expect(can(ctx, userActor(moderator), "search.use")).toBe(true);
    // Removing the last member entry returns the member to the shared combination.
    setEntry(ctx, { userId: other.id }, "search.use", null);
    expect(combination(other.id)).toEqual({ user_id: 0, group_ids: "2" });
  });

  test("bans and restrictions are checked first and override every grant", () => {
    const ctx = createTestContext();
    const n = tree(ctx);
    const admin = insertUser(ctx, { groupId: GROUP_IDS.admin });
    const actor = userActor(admin);
    expect(can(ctx, actor, "admin.permissions")).toBe(true);
    expect(can(ctx, actor, "forum.createThread", { nodeId: n.child })).toBe(true);

    ctx.sqlite
      .prepare("UPDATE users SET restricted_posting_until = ?1 WHERE id = ?2")
      .run(ctx.now() + 60_000, admin.id);
    expect(can(ctx, actor, "forum.createThread", { nodeId: n.child })).toBe(false);
    expect(can(ctx, actor, "forum.reply", { nodeId: n.child, threadBanned: false })).toBe(false);
    expect(can(ctx, actor, "conversation.start")).toBe(true);
    ctx.clock.advance(60_001);
    expect(can(ctx, actor, "forum.createThread", { nodeId: n.child })).toBe(true);
    ctx.sqlite
      .prepare("UPDATE users SET restricted_conversations_until = ?1 WHERE id = ?2")
      .run(RESTRICTION_PERMANENT, admin.id);
    expect(can(ctx, actor, "conversation.start")).toBe(false);

    ctx.sqlite
      .prepare("UPDATE users SET banned_until = ?1 WHERE id = ?2")
      .run(ctx.now() + 60_000, admin.id);
    for (const id of ["admin.permissions", "search.use", "profile.view"] as const)
      expect(can(ctx, actor, id)).toBe(false);
    expect(can(ctx, actor, "node.view", { nodeId: n.root })).toBe(false);
    expect(permissionValue(ctx, actor, "attachment.storageQuota")).toBe(0);
    expect(viewableNodeIds(ctx, actor)).toEqual([]);
    ctx.sqlite
      .prepare("UPDATE users SET banned_until = NULL, banned_permanently = 1 WHERE id = ?1")
      .run(admin.id);
    expect(can(ctx, actor, "search.use")).toBe(false);
  });

  test("a thread ban denies replying in that thread only", () => {
    const ctx = createTestContext();
    const n = tree(ctx);
    const actor = userActor(insertUser(ctx));
    expect(can(ctx, actor, "forum.reply", { nodeId: n.child, threadBanned: false })).toBe(true);
    expect(can(ctx, actor, "forum.reply", { nodeId: n.child, threadBanned: true })).toBe(false);
    expect(can(ctx, actor, "forum.createThread", { nodeId: n.child })).toBe(true);
  });

  test("guests never get permissions that need an account, whatever the entries say", () => {
    const ctx = createTestContext();
    const n = tree(ctx);
    setEntry(ctx, { groupId: GROUP_IDS.guest }, "forum.createThread", "allow");
    setEntry(ctx, { groupId: GROUP_IDS.guest }, "reaction.react", "allow");
    const guest: Actor = { kind: "guest" };
    expect(can(ctx, guest, "forum.createThread", { nodeId: n.child })).toBe(false);
    expect(can(ctx, guest, "reaction.react")).toBe(false);
    expect(can(ctx, guest, "node.view", { nodeId: n.child })).toBe(true);
    expect(() => requirePermission(ctx, guest, "reaction.react")).toThrow("signed in");
  });

  test("own-content permissions need ownership and respect the time window", () => {
    const ctx = createTestContext();
    const n = tree(ctx);
    const user = insertUser(ctx);
    const actor = userActor(user);
    const context = (ownerId: number, ageMs: number) => ({
      nodeId: n.child,
      ownerId,
      createdAt: ctx.now() - ageMs,
    });
    expect(can(ctx, actor, "forum.editOwn", context(user.id, 10 * 86_400_000))).toBe(true);
    expect(can(ctx, actor, "forum.editOwn", context(user.id + 1000, 0))).toBe(false);
    setEntry(ctx, { groupId: GROUP_IDS.member }, "forum.editOwnTimeLimit", 10, n.parent);
    expect(can(ctx, actor, "forum.editOwn", context(user.id, 5 * 60_000))).toBe(true);
    expect(can(ctx, actor, "forum.editOwn", context(user.id, 11 * 60_000))).toBe(false);
    expect(
      can(ctx, actor, "forum.editOwn", { ...context(user.id, 11 * 60_000), nodeId: n.root }),
    ).toBe(true);
    expect(() => can(ctx, actor, "forum.editOwn", { nodeId: n.child })).toThrow("ownerId");
  });

  test("hierarchy: nobody acts on a member of equal or higher rank", () => {
    const ctx = createTestContext();
    const moderator = userActor(insertUser(ctx, { groupId: GROUP_IDS.moderator }));
    const admin = userActor(insertUser(ctx, { groupId: GROUP_IDS.admin }));
    const targets: [Actor, boolean, boolean][] = [
      [userActor(insertUser(ctx)), true, true],
      [userActor(insertUser(ctx, { groupId: GROUP_IDS.moderator })), false, true],
      [userActor(insertUser(ctx, { groupId: GROUP_IDS.admin })), false, false],
    ];
    for (const [target, byModerator, byAdmin] of targets) {
      expect(can(ctx, moderator, "member.warn", { target })).toBe(byModerator);
      expect(can(ctx, admin, "member.warn", { target })).toBe(byAdmin);
    }
    // A member's highest rank among all their groups counts.
    const senior = createGroup(ctx, "Senior", 60);
    const promoted = insertUser(ctx);
    addToGroup(ctx, promoted.id, senior);
    expect(can(ctx, moderator, "member.warn", { target: userActor(promoted) })).toBe(false);
    expect(memberStanding(ctx, userActor(promoted))).toEqual({
      maxRank: 60,
      displayGroupId: senior,
    });
  });

  test("explain shows the result and the entry each group contributed", () => {
    const ctx = createTestContext();
    const n = tree(ctx);
    const a = createGroup(ctx, "Helpers");
    setEntry(ctx, { groupId: a }, "forum.deleteAny", "allow", n.parent);
    const user = insertUser(ctx);
    addToGroup(ctx, user.id, a);
    const explanation = explainPermission(ctx, userActor(user), "forum.deleteAny", {
      nodeId: n.grandchild,
    });
    expect(explanation.granted).toBe(true);
    expect(explanation.layers).toEqual([
      {
        kind: "group",
        groupId: GROUP_IDS.member,
        userId: null,
        title: "Member",
        value: "unset",
        sourceNodeId: null,
      },
      {
        kind: "group",
        groupId: a,
        userId: null,
        title: "Helpers",
        value: "allow",
        sourceNodeId: n.parent,
      },
    ]);
    setEntry(ctx, { groupId: GROUP_IDS.member }, "forum.deleteAny", "never");
    const denied = explainPermission(ctx, userActor(user), "forum.deleteAny", { nodeId: n.child });
    expect(denied.granted).toBe(false);
    expect(denied.layers[0]).toMatchObject({ value: "never", sourceNodeId: 0 });
    ctx.sqlite.prepare("UPDATE users SET banned_permanently = 1 WHERE id = ?1").run(user.id);
    expect(explainPermission(ctx, userActor(user), "search.use").deniedBy).toBe("banned");
  });

  test("resolved permissions describe the actor for a scope", () => {
    const ctx = createTestContext();
    const n = tree(ctx);
    const guest = resolvedPermissions(ctx, { kind: "guest" });
    expect(guest["profile.view"]).toBe(true);
    expect(guest["reaction.react"]).toBe(false);
    expect(guest["node.view"]).toBeUndefined();
    const node = resolvedPermissions(ctx, userActor(insertUser(ctx)), { nodeId: n.child });
    expect(node["forum.createThread"]).toBe(true);
    expect(node["forum.deleteAny"]).toBe(false);
    expect(node["forum.editOwnTimeLimit"]).toBe(-1);
    expect(node["search.use"]).toBeUndefined();
  });
});

describe("defaults and migration", () => {
  test("the migrated built-in groups hold exactly the registry defaults", () => {
    const ctx = createTestContext();
    const rows = ctx.sqlite
      .prepare<{ key: string; builtin: string; value: number }, []>(
        "SELECT d.key, g.builtin, e.value FROM permission_entries e JOIN permission_definitions d ON d.id = e.permission_id JOIN groups g ON g.id = e.group_id WHERE e.node_id = 0 AND e.user_id = 0",
      )
      .all();
    const actual = new Map(rows.map((r) => [`${r.key}|${r.builtin}`, r.value]));
    const expected = new Map<string, number>();
    for (const id of PERMISSION_IDS) {
      const def: PermissionDefinition = PERMISSIONS[id];
      for (const [builtin, value] of Object.entries(def.defaults))
        expected.set(
          `${id}|${builtin}`,
          typeof value === "number" ? value : value === "allow" ? 1 : -1,
        );
    }
    // Administrators had every yes/no permission; the registry says the same through defaults
    // except where a flag is granted to administrators by nothing at all.
    for (const id of PERMISSION_IDS)
      if (PERMISSIONS[id].type === "flag" && !expected.has(`${id}|admin`))
        expected.set(`${id}|admin`, 1);
    expect(Object.fromEntries(actual)).toEqual(Object.fromEntries(expected));
  });

  test("every time-limit reference names an integer permission of the same scope", () => {
    for (const id of PERMISSION_IDS) {
      const def: PermissionDefinition = PERMISSIONS[id];
      if (def.type !== "flag" || !def.timeLimit) continue;
      const limit = PERMISSIONS[def.timeLimit as PermissionId] as PermissionDefinition | undefined;
      expect(limit?.type).toBe("integer");
      expect(limit?.scope).toBe(def.scope);
    }
  });

  test("the registry sync stores a new permission with its built-in defaults once", () => {
    const ctx = createTestContext();
    const definition = ctx.sqlite
      .prepare<{ id: number }, []>("SELECT id FROM permission_definitions WHERE key = 'search.use'")
      .get()!.id;
    ctx.sqlite.prepare("DELETE FROM permission_entries WHERE permission_id = ?1").run(definition);
    ctx.sqlite.prepare("DELETE FROM permission_definitions WHERE id = ?1").run(definition);
    expect(syncPermissionRegistry(ctx)).toBe(1);
    expect(syncPermissionRegistry(ctx)).toBe(0);
    expect(can(ctx, { kind: "guest" }, "search.use")).toBe(true);
    expect(can(ctx, userActor(insertUser(ctx)), "search.use")).toBe(true);
  });

  test("legacy group flags and node overrides written directly are mirrored into entries", () => {
    const ctx = createTestContext();
    const n = tree(ctx);
    const actor = userActor(insertUser(ctx));
    ctx.sqlite.run("UPDATE groups SET can_react = 0 WHERE id = 2");
    expect(can(ctx, actor, "reaction.react")).toBe(false);
    ctx.sqlite.run("UPDATE groups SET can_react = 1 WHERE id = 2");
    expect(can(ctx, actor, "reaction.react")).toBe(true);
    ctx.sqlite
      .prepare("INSERT INTO node_permissions (node_id, group_id, can_view) VALUES (?1, 2, 0)")
      .run(n.parent);
    expect(can(ctx, actor, "node.view", { nodeId: n.child })).toBe(false);
    ctx.sqlite.prepare("UPDATE node_permissions SET can_view = 1 WHERE node_id = ?1").run(n.parent);
    expect(can(ctx, actor, "node.view", { nodeId: n.child })).toBe(true);
    ctx.sqlite
      .prepare("UPDATE node_permissions SET can_moderate = 1 WHERE node_id = ?1")
      .run(n.parent);
    expect(can(ctx, actor, "forum.deleteAny", { nodeId: n.child })).toBe(true);
    ctx.sqlite.prepare("DELETE FROM node_permissions WHERE node_id = ?1").run(n.parent);
    expect(can(ctx, actor, "forum.deleteAny", { nodeId: n.child })).toBe(false);
    // Leaving and rejoining administration keeps everyday permissions.
    ctx.sqlite.run("UPDATE groups SET is_admin = 1 WHERE id = 2");
    expect(can(ctx, actor, "admin.settings")).toBe(true);
    ctx.sqlite.run("UPDATE groups SET is_admin = 0 WHERE id = 2");
    expect(can(ctx, actor, "admin.settings")).toBe(false);
    expect(
      can(ctx, actor, "forum.editOwn", {
        nodeId: n.child,
        ownerId: actor.kind === "guest" ? 0 : actor.userId,
        createdAt: 0,
      }),
    ).toBe(true);
  });

  test("a member's combination follows their secondary groups", () => {
    const ctx = createTestContext();
    const user = insertUser(ctx);
    const helpers = createGroup(ctx, "Helpers");
    const combination = () =>
      ctx.sqlite
        .prepare<{ group_ids: string }, [number]>(
          "SELECT c.group_ids FROM users u JOIN permission_combinations c ON c.id = u.permission_combination_id WHERE u.id = ?1",
        )
        .get(user.id)!.group_ids;
    expect(combination()).toBe("2");
    addToGroup(ctx, user.id, helpers);
    expect(combination()).toBe(`2,${helpers}`);
    ctx.sqlite.prepare("UPDATE users SET group_id = 3 WHERE id = ?1").run(user.id);
    expect(combination()).toBe(`3,${helpers}`);
    ctx.sqlite.prepare("DELETE FROM user_groups WHERE user_id = ?1").run(user.id);
    expect(combination()).toBe("3");
  });
});

describe("permission state", () => {
  function fileContexts() {
    const dir = mkdtempSync(join(tmpdir(), "sermo-permissions-"));
    const path = join(dir, "test.db");
    const a = createContext({ path, migrate: true });
    const b = createContext({ path });
    return {
      a,
      b,
      close() {
        closeContext(a);
        closeContext(b);
        rmSync(dir, { recursive: true, force: true });
      },
    };
  }

  function loadedActor(ctx: Ctx, userId: number): Actor {
    const row = ctx.sqlite
      .prepare<PrincipalRow & { group_id: number }, [number]>(
        `SELECT u.group_id, ${PRINCIPAL_COLUMNS} FROM users u WHERE u.id = ?1`,
      )
      .get(userId)!;
    return memberActor(userId, row.group_id, row, currentVersions(ctx));
  }

  test("a check on a resolved actor runs no query", () => {
    const ctx = createTestContext();
    const n = tree(ctx);
    const actor = loadedActor(ctx, insertUser(ctx).id);
    can(ctx, actor, "node.view", { nodeId: n.child });
    let queries = 0;
    const prepare = ctx.sqlite.prepare.bind(ctx.sqlite);
    const query = ctx.sqlite.query.bind(ctx.sqlite);
    Reflect.set(ctx.sqlite, "prepare", (sql: string) => {
      queries++;
      return prepare(sql);
    });
    Reflect.set(ctx.sqlite, "query", (sql: string) => {
      queries++;
      return query(sql);
    });
    const permissions = permissionsOf(ctx, actor);
    for (let i = 0; i < 1000; i++) {
      can(ctx, actor, "forum.createThread", { nodeId: n.grandchild });
      can(ctx, actor, "admin.settings");
      permissions.can("forum.reply", { nodeId: n.child, threadBanned: false });
      permissionValue(ctx, actor, "attachment.storageQuota");
    }
    expect(queries).toBe(0);
  });

  test("another process's change reloads only the changed layer", () => {
    const { a, b, close } = fileContexts();
    try {
      const user = insertUser(a);
      const helpers = createGroup(a, "Helpers");
      addToGroup(a, user.id, helpers);
      expect(can(a, loadedActor(a, user.id), "search.use")).toBe(true);
      const before = permissionState(a);
      const otherLayer = before.layers.get("g:4");
      setEntry(b, { groupId: helpers }, "search.use", "never");
      const actor = loadedActor(a, user.id);
      expect(can(a, actor, "search.use")).toBe(false);
      const after = permissionState(
        a,
        actor.kind === "user" ? actor.principal!.versions : undefined,
      );
      expect(after).toBe(before);
      expect(after.layers.get("g:4")).toBe(otherLayer!);
      // The node tree moving in another process is picked up too.
      const node = insertNode(b, {}).id;
      invalidate(b, "node_tree");
      expect(can(a, loadedActor(a, user.id), "node.view", { nodeId: node })).toBe(true);
    } finally {
      close();
    }
  });

  test("a state built inside a rolled-back transaction is never kept", () => {
    const ctx = createTestContext();
    const actor = userActor(insertUser(ctx));
    expect(can(ctx, actor, "search.use")).toBe(true);
    expect(() =>
      ctx.db.transaction(
        () => {
          setEntry(ctx, { groupId: GROUP_IDS.member }, "search.use", "never");
          expect(can(ctx, actor, "search.use")).toBe(false);
          throw new Error("rollback");
        },
        { behavior: "immediate" },
      ),
    ).toThrow("rollback");
    expect(can(ctx, actor, "search.use")).toBe(true);
  });

  test("combinations created after the state was built are found", () => {
    const ctx = createTestContext();
    const user = insertUser(ctx);
    expect(combinationsGranting(ctx, "admin.permissions")).toEqual([]);
    // A membership change creates a combination without a permission version change.
    ctx.sqlite.prepare("UPDATE users SET group_id = 4 WHERE id = ?1").run(user.id);
    const granting = combinationsGranting(ctx, "admin.permissions");
    expect(granting).toHaveLength(1);
    expect(can(ctx, loadedActor(ctx, user.id), "admin.permissions")).toBe(true);
  });

  test("a combination read inside a rolled-back transaction never poisons the state", () => {
    const ctx = createTestContext();
    const first = insertUser(ctx);
    const second = insertUser(ctx);
    const helpers = createGroup(ctx, "Helpers");
    const staff = createGroup(ctx, "Staff");
    setEntry(ctx, { groupId: staff }, "admin.settings", "allow");
    expect(can(ctx, userActor(first), "search.use")).toBe(true);
    expect(() =>
      ctx.db.transaction(
        () => {
          addToGroup(ctx, first.id, helpers);
          expect(can(ctx, loadedActor(ctx, first.id), "admin.settings")).toBe(false);
          throw new Error("rollback");
        },
        { behavior: "immediate" },
      ),
    ).toThrow("rollback");
    // The rolled-back combination id is reused for a different set of groups.
    addToGroup(ctx, second.id, staff);
    expect(can(ctx, loadedActor(ctx, second.id), "admin.settings")).toBe(true);
    expect(can(ctx, loadedActor(ctx, first.id), "admin.settings")).toBe(false);
  });

  test("combinations are precomputed in the background in yielding batches", async () => {
    const ctx = createTestContext();
    for (let i = 0; i < 250; i++) {
      const group = createGroup(ctx, `G${i}`);
      member(ctx, GROUP_IDS.member, group);
    }
    const state = permissionState(ctx);
    const total = state.combinationDefs.size;
    expect(total).toBeGreaterThan(250);
    expect(state.combinations.size).toBeLessThan(total);
    for (let i = 0; i < 20 && state.combinations.size < total; i++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    expect(state.combinations.size).toBe(total);
  });
});
