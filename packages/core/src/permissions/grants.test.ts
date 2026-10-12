import { describe, expect, test } from "bun:test";
import { type Ctx, invalidate } from "../context";
import { GROUP_IDS } from "../db/schema";
import { writeTx } from "../db/tx";
import { NotFoundError, ValidationError } from "../errors";
import { createTestContext, insertNode, insertUser, userActor } from "../testing";
import {
  can,
  explainPermission,
  grantPurchased,
  type PermissionId,
  type PurchasedGrant,
  permissionValue,
  revokePurchased,
  validatePurchasedGrant,
} from ".";

const SECRET_FLAG = "credits.viewAny" as const; // moderators only by default
const QUOTA = "attachment.storageQuota" as const;

function setEntry(
  ctx: Ctx,
  groupId: number,
  permission: PermissionId,
  value: number,
  nodeId = 0,
  userId = 0,
) {
  const definition = ctx.sqlite
    .prepare<{ id: number }, [string]>("SELECT id FROM permission_definitions WHERE key = ?1")
    .get(permission)!.id;
  ctx.sqlite
    .prepare(
      "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES (?1, ?2, ?3, ?4, ?5)",
    )
    .run(definition, nodeId, groupId, userId, value);
}

function createGroup(ctx: Ctx, title: string): number {
  return ctx.sqlite
    .prepare<{ id: number }, [string]>(
      "INSERT INTO groups (title, rank) VALUES (?1, 10) RETURNING id",
    )
    .get(title)!.id;
}

/** A member whose only group is a fresh group that can view nodes and nothing else. */
function setup() {
  const ctx = createTestContext();
  const group = createGroup(ctx, "Plain");
  setEntry(ctx, group, "node.view", 1);
  const user = insertUser(ctx, { groupId: group });
  return { ctx, group, user, actor: () => userActor(user) };
}

let inventory = 100;
const nextInventory = () => {
  inventory += 1;
  return inventory;
};
const grant = (ctx: Ctx, userId: number, g: PurchasedGrant, inventoryId = nextInventory()) => {
  const result = writeTx(ctx, () => grantPurchased(ctx, userId, inventoryId, g));
  return { ...result, inventoryId };
};
const revoke = (ctx: Ctx, inventoryId: number) =>
  writeTx(ctx, () => revokePurchased(ctx, inventoryId));

const combination = (ctx: Ctx, userId: number) =>
  ctx.sqlite
    .prepare<{ id: number; user_id: number; group_ids: string }, [number]>(
      "SELECT c.id, c.user_id, c.group_ids FROM users u JOIN permission_combinations c ON c.id = u.permission_combination_id WHERE u.id = ?1",
    )
    .get(userId)!;

describe("purchased permissions", () => {
  test("a flag becomes granted right after the grant and stops right after the revoke", () => {
    const { ctx, user, actor } = setup();
    expect(can(ctx, actor(), SECRET_FLAG)).toBe(false);
    const shared = combination(ctx, user.id);
    expect(shared.user_id).toBe(0);

    const { inventoryId } = grant(ctx, user.id, { type: "permission", permission: SECRET_FLAG });
    expect(can(ctx, actor(), SECRET_FLAG)).toBe(true);
    const privateCombination = combination(ctx, user.id);
    expect(privateCombination.user_id).toBe(user.id);
    expect(privateCombination.group_ids).toBe(shared.group_ids);
    expect(privateCombination.id).not.toBe(shared.id);

    revoke(ctx, inventoryId);
    expect(can(ctx, actor(), SECRET_FLAG)).toBe(false);
    expect(combination(ctx, user.id)).toEqual(shared);
  });

  test("a ctx that already resolved the member sees the purchase with a new actor", () => {
    const { ctx, user } = setup();
    const before = userActor(user);
    expect(can(ctx, before, SECRET_FLAG)).toBe(false);
    expect(permissionValue(ctx, before, QUOTA)).toBe(0);
    const { inventoryId } = grant(ctx, user.id, { type: "permission", permission: SECRET_FLAG });
    grant(ctx, user.id, { type: "permission", permission: QUOTA, value: 500 });
    expect(can(ctx, userActor(user), SECRET_FLAG)).toBe(true);
    expect(permissionValue(ctx, userActor(user), QUOTA)).toBe(500);
    revoke(ctx, inventoryId);
    expect(can(ctx, userActor(user), SECRET_FLAG)).toBe(false);
    expect(permissionValue(ctx, userActor(user), QUOTA)).toBe(500);
  });

  test("other members are not affected", () => {
    const { ctx, group, user } = setup();
    const other = insertUser(ctx, { groupId: group });
    grant(ctx, user.id, { type: "permission", permission: SECRET_FLAG });
    expect(can(ctx, userActor(other), SECRET_FLAG)).toBe(false);
    expect(combination(ctx, other.id).user_id).toBe(0);
  });

  test("a never on one of the member's groups still denies a purchased permission", () => {
    const { ctx, user, actor } = setup();
    const blocker = createGroup(ctx, "Blocker");
    setEntry(ctx, blocker, SECRET_FLAG, -1);
    ctx.sqlite
      .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, ?2, 0)")
      .run(user.id, blocker);
    grant(ctx, user.id, { type: "permission", permission: SECRET_FLAG });
    expect(can(ctx, actor(), SECRET_FLAG)).toBe(false);
    expect(explainPermission(ctx, actor(), SECRET_FLAG).layers.map((l) => l.value)).toContain(
      "never",
    );
  });

  test("a never entry set for the member denies it too", () => {
    const { ctx, group, user, actor } = setup();
    setEntry(ctx, group, SECRET_FLAG, -1);
    grant(ctx, user.id, { type: "permission", permission: SECRET_FLAG });
    expect(can(ctx, actor(), SECRET_FLAG)).toBe(false);
  });

  test("an integer takes the highest of the group value and the purchased value", () => {
    const { ctx, group, user, actor } = setup();
    setEntry(ctx, group, QUOTA, 100);
    expect(permissionValue(ctx, actor(), QUOTA)).toBe(100);
    const lower = grant(ctx, user.id, { type: "permission", permission: QUOTA, value: 50 });
    expect(permissionValue(ctx, actor(), QUOTA)).toBe(100);
    const higher = grant(ctx, user.id, { type: "permission", permission: QUOTA, value: 900 });
    expect(permissionValue(ctx, actor(), QUOTA)).toBe(900);
    const unlimited = grant(ctx, user.id, { type: "permission", permission: QUOTA, value: -1 });
    expect(permissionValue(ctx, actor(), QUOTA)).toBe(-1);
    revoke(ctx, unlimited.inventoryId);
    expect(permissionValue(ctx, actor(), QUOTA)).toBe(900);
    revoke(ctx, higher.inventoryId);
    expect(permissionValue(ctx, actor(), QUOTA)).toBe(100);
    revoke(ctx, lower.inventoryId);
    expect(permissionValue(ctx, actor(), QUOTA)).toBe(100);
  });

  test("an unlimited purchase wins over a higher group value", () => {
    const { ctx, group, user, actor } = setup();
    setEntry(ctx, group, QUOTA, 10_000_000);
    grant(ctx, user.id, { type: "permission", permission: QUOTA, value: -1 });
    expect(permissionValue(ctx, actor(), QUOTA)).toBe(-1);
  });

  test("a purchased integer of 0 grants nothing", () => {
    const { ctx, user, actor } = setup();
    grant(ctx, user.id, { type: "permission", permission: QUOTA, value: 0 });
    expect(permissionValue(ctx, actor(), QUOTA)).toBe(0);
  });

  test("two inventory rows granting the same permission: revoking one keeps it granted", () => {
    const { ctx, user, actor } = setup();
    const first = grant(ctx, user.id, { type: "permission", permission: SECRET_FLAG });
    const second = grant(ctx, user.id, { type: "permission", permission: SECRET_FLAG });
    revoke(ctx, first.inventoryId);
    expect(can(ctx, actor(), SECRET_FLAG)).toBe(true);
    expect(combination(ctx, user.id).user_id).toBe(user.id);
    revoke(ctx, second.inventoryId);
    expect(can(ctx, actor(), SECRET_FLAG)).toBe(false);
    expect(combination(ctx, user.id).user_id).toBe(0);
  });

  test("granting twice for one inventory row stores one grant", () => {
    const { ctx, user } = setup();
    const { inventoryId } = grant(ctx, user.id, {
      type: "permission",
      permission: QUOTA,
      value: 5,
    });
    grant(ctx, user.id, { type: "permission", permission: QUOTA, value: 5 }, inventoryId);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM shop_permission_grants WHERE inventory_id = ?1",
        )
        .get(inventoryId)!.n,
    ).toBe(1);
  });

  test("one inventory row can hold several permissions and revoking removes them all", () => {
    const { ctx, user, actor } = setup();
    const { inventoryId } = grant(ctx, user.id, { type: "permission", permission: SECRET_FLAG });
    grant(ctx, user.id, { type: "permission", permission: QUOTA, value: 7 }, inventoryId);
    expect(permissionValue(ctx, actor(), QUOTA)).toBe(7);
    revoke(ctx, inventoryId);
    expect(permissionValue(ctx, actor(), QUOTA)).toBe(0);
    expect(can(ctx, actor(), SECRET_FLAG)).toBe(false);
  });

  test("revoking an unknown inventory row does nothing", () => {
    const { ctx } = setup();
    expect(revoke(ctx, 424_242)).toEqual({ groupsRemoved: [] });
  });

  test("a node-scoped permission applies on a viewable node, not on one the member cannot view", () => {
    const { ctx, group, user, actor } = setup();
    const root = insertNode(ctx, { type: "category" }).id;
    const visible = insertNode(ctx, { parentId: root }).id;
    const hidden = insertNode(ctx, { parentId: root }).id;
    invalidate(ctx, "node_tree");
    setEntry(ctx, group, "node.view", 0, hidden);
    expect(can(ctx, actor(), "forum.viewDeleted", { nodeId: visible })).toBe(false);
    grant(ctx, user.id, { type: "permission", permission: "forum.viewDeleted" });
    expect(can(ctx, actor(), "node.view", { nodeId: hidden })).toBe(false);
    expect(can(ctx, actor(), "forum.viewDeleted", { nodeId: visible })).toBe(true);
    expect(can(ctx, actor(), "forum.viewDeleted", { nodeId: root })).toBe(true);
    expect(can(ctx, actor(), "forum.viewDeleted", { nodeId: hidden })).toBe(false);
    expect(explainPermission(ctx, actor(), "forum.viewDeleted", { nodeId: hidden }).deniedBy).toBe(
      "viewRequired",
    );
  });

  test("the member-specific entry layer and the purchased layer coexist", () => {
    const { ctx, user, actor } = setup();
    const other = "search.use" as const;
    // search.use is open to everyone by default; take it away for this member only.
    setEntry(ctx, 0, other, -1, 0, user.id);
    setEntry(ctx, 0, "member.follow", 1, 0, user.id);
    expect(can(ctx, actor(), other)).toBe(false);
    const { inventoryId } = grant(ctx, user.id, { type: "permission", permission: SECRET_FLAG });
    expect(can(ctx, actor(), SECRET_FLAG)).toBe(true);
    expect(can(ctx, actor(), other)).toBe(false);
    expect(can(ctx, actor(), "member.follow")).toBe(true);
    expect(combination(ctx, user.id).user_id).toBe(user.id);
    const layers = explainPermission(ctx, actor(), SECRET_FLAG).layers;
    expect(layers.map((l) => l.kind).sort()).toEqual(["group", "member", "purchase"]);
    // Revoking the purchase keeps the private combination because of the member entries.
    revoke(ctx, inventoryId);
    expect(can(ctx, actor(), SECRET_FLAG)).toBe(false);
    expect(can(ctx, actor(), other)).toBe(false);
    expect(can(ctx, actor(), "member.follow")).toBe(true);
    expect(combination(ctx, user.id).user_id).toBe(user.id);
  });

  test("explainPermission reports a purchase layer", () => {
    const { ctx, user, actor } = setup();
    grant(ctx, user.id, { type: "permission", permission: SECRET_FLAG });
    grant(ctx, user.id, { type: "permission", permission: QUOTA, value: 300 });
    const flag = explainPermission(ctx, actor(), SECRET_FLAG);
    expect(flag.granted).toBe(true);
    expect(flag.layers.find((l) => l.kind === "purchase")).toEqual({
      kind: "purchase",
      groupId: null,
      userId: user.id,
      title: null,
      value: "allow",
      sourceNodeId: 0,
    });
    const quota = explainPermission(ctx, actor(), QUOTA);
    expect(quota.value).toBe(300);
    expect(quota.layers.find((l) => l.kind === "purchase")).toMatchObject({
      value: 300,
      userId: user.id,
    });
  });

  test("bans and restrictions still override a purchased permission", () => {
    const { ctx, user, actor } = setup();
    grant(ctx, user.id, { type: "permission", permission: SECRET_FLAG });
    grant(ctx, user.id, { type: "permission", permission: QUOTA, value: 300 });
    ctx.sqlite.prepare("UPDATE users SET banned_permanently = 1 WHERE id = ?1").run(user.id);
    expect(can(ctx, actor(), SECRET_FLAG)).toBe(false);
    expect(permissionValue(ctx, actor(), QUOTA)).toBe(0);
    ctx.sqlite.prepare("UPDATE users SET banned_permanently = 0 WHERE id = ?1").run(user.id);
    expect(can(ctx, actor(), SECRET_FLAG)).toBe(true);
    ctx.sqlite
      .prepare("UPDATE users SET banned_until = ?1 WHERE id = ?2")
      .run(ctx.now() + 1000, user.id);
    expect(can(ctx, actor(), SECRET_FLAG)).toBe(false);
  });

  test("deleting the user cascades the grant rows", () => {
    const { ctx, user } = setup();
    grant(ctx, user.id, { type: "permission", permission: SECRET_FLAG });
    const target = createGroup(ctx, "Perk");
    grant(ctx, user.id, { type: "group", groupId: target });
    const count = (table: string) =>
      ctx.sqlite
        .prepare<{ n: number }, [number]>(`SELECT count(*) AS n FROM ${table} WHERE user_id = ?1`)
        .get(user.id)!.n;
    expect([count("shop_permission_grants"), count("shop_group_grants")]).toEqual([1, 1]);
    ctx.sqlite.prepare("DELETE FROM users WHERE id = ?1").run(user.id);
    expect([count("shop_permission_grants"), count("shop_group_grants")]).toEqual([0, 0]);
  });
});

describe("purchased groups", () => {
  test("a group is added to the member's combination and removed on revoke", () => {
    const { ctx, group, user, actor } = setup();
    const perk = createGroup(ctx, "Perk");
    setEntry(ctx, perk, SECRET_FLAG, 1);
    expect(combination(ctx, user.id).group_ids).toBe(String(group));
    const added = grant(ctx, user.id, { type: "group", groupId: perk });
    expect(added.groupAdded).toBe(true);
    expect(combination(ctx, user.id).group_ids.split(",").map(Number).sort()).toEqual(
      [group, perk].sort(),
    );
    expect(can(ctx, actor(), SECRET_FLAG)).toBe(true);
    expect(revoke(ctx, added.inventoryId)).toEqual({ groupsRemoved: [perk] });
    expect(combination(ctx, user.id).group_ids).toBe(String(group));
    expect(can(ctx, actor(), SECRET_FLAG)).toBe(false);
  });

  test("groupAdded is false when the member already holds the group through another source", () => {
    const { ctx, group, user } = setup();
    // Primary group.
    expect(grant(ctx, user.id, { type: "group", groupId: group }).groupAdded).toBe(false);
    // Secondary group (user_groups).
    const secondary = createGroup(ctx, "Secondary");
    ctx.sqlite
      .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, ?2, 0)")
      .run(user.id, secondary);
    expect(grant(ctx, user.id, { type: "group", groupId: secondary }).groupAdded).toBe(false);
    // Promotion grant (user_group_grants).
    const promoted = createGroup(ctx, "Promoted");
    const promotion = ctx.sqlite
      .prepare<{ id: number }, []>(
        "INSERT INTO promotions (title, created_at, updated_at) VALUES ('P', 0, 0) RETURNING id",
      )
      .get()!.id;
    ctx.sqlite
      .prepare(
        "INSERT INTO user_group_grants (user_id, promotion_id, group_id, created_at) VALUES (?1, ?2, ?3, 0)",
      )
      .run(user.id, promotion, promoted);
    expect(grant(ctx, user.id, { type: "group", groupId: promoted }).groupAdded).toBe(false);
    // Another shop item already gives it.
    const shop = createGroup(ctx, "Shop");
    expect(grant(ctx, user.id, { type: "group", groupId: shop }).groupAdded).toBe(true);
    expect(grant(ctx, user.id, { type: "group", groupId: shop }).groupAdded).toBe(false);
  });

  test("revoke reports a group only when no other source still gives it", () => {
    const { ctx, group, user, actor } = setup();
    const perk = createGroup(ctx, "Perk");
    setEntry(ctx, perk, SECRET_FLAG, 1);
    const first = grant(ctx, user.id, { type: "group", groupId: perk });
    const second = grant(ctx, user.id, { type: "group", groupId: perk });
    expect(revoke(ctx, first.inventoryId)).toEqual({ groupsRemoved: [] });
    expect(can(ctx, actor(), SECRET_FLAG)).toBe(true);
    expect(revoke(ctx, second.inventoryId)).toEqual({ groupsRemoved: [perk] });
    expect(can(ctx, actor(), SECRET_FLAG)).toBe(false);

    // Held by a secondary group as well: nothing removed, access stays.
    ctx.sqlite
      .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, ?2, 0)")
      .run(user.id, perk);
    const third = grant(ctx, user.id, { type: "group", groupId: perk });
    expect(third.groupAdded).toBe(false);
    expect(revoke(ctx, third.inventoryId)).toEqual({ groupsRemoved: [] });
    expect(can(ctx, actor(), SECRET_FLAG)).toBe(true);

    // Granting the primary group through the shop never reports it removed.
    const fourth = grant(ctx, user.id, { type: "group", groupId: group });
    expect(revoke(ctx, fourth.inventoryId)).toEqual({ groupsRemoved: [] });
  });

  test("a purchased group combines with a purchased permission in one private combination", () => {
    const { ctx, group, user, actor } = setup();
    const perk = createGroup(ctx, "Perk");
    setEntry(ctx, perk, QUOTA, 40);
    const g = grant(ctx, user.id, { type: "group", groupId: perk });
    const p = grant(ctx, user.id, { type: "permission", permission: QUOTA, value: 10 });
    const row = combination(ctx, user.id);
    expect(row.user_id).toBe(user.id);
    expect(row.group_ids.split(",").map(Number).sort()).toEqual([group, perk].sort());
    expect(permissionValue(ctx, actor(), QUOTA)).toBe(40);
    revoke(ctx, g.inventoryId);
    expect(permissionValue(ctx, actor(), QUOTA)).toBe(10);
    revoke(ctx, p.inventoryId);
    expect(permissionValue(ctx, actor(), QUOTA)).toBe(0);
  });
});

describe("validatePurchasedGrant", () => {
  const ctx = createTestContext();

  test("accepts well-formed grants", () => {
    const custom = createGroup(ctx, "Sellable");
    for (const g of [
      { type: "permission", permission: SECRET_FLAG },
      { type: "permission", permission: QUOTA, value: 0 },
      { type: "permission", permission: QUOTA, value: 25 },
      { type: "permission", permission: QUOTA, value: -1 },
      { type: "group", groupId: custom },
      { type: "group", groupId: GROUP_IDS.member },
    ] as PurchasedGrant[])
      expect(() => validatePurchasedGrant(ctx, g)).not.toThrow();
  });

  test("rejects an unknown permission, including inherited object keys", () => {
    for (const permission of ["nope.nothing", "", "constructor", "__proto__", "toString"])
      expect(() => validatePurchasedGrant(ctx, { type: "permission", permission })).toThrow(
        ValidationError,
      );
  });

  test("rejects a value on a flag", () => {
    for (const value of [0, 1, -1])
      expect(() =>
        validatePurchasedGrant(ctx, { type: "permission", permission: SECRET_FLAG, value }),
      ).toThrow(ValidationError);
  });

  test("rejects a missing or invalid value on an integer permission", () => {
    for (const value of [undefined, -2, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() =>
        validatePurchasedGrant(ctx, { type: "permission", permission: QUOTA, value }),
      ).toThrow(ValidationError);
  });

  test("rejects a missing group (NotFoundError) and the guest group", () => {
    expect(() => validatePurchasedGrant(ctx, { type: "group", groupId: 987_654 })).toThrow(
      NotFoundError,
    );
    expect(() => validatePurchasedGrant(ctx, { type: "group", groupId: GROUP_IDS.guest })).toThrow(
      ValidationError,
    );
  });

  test("grantPurchased refuses malformed grants and writes nothing", () => {
    const { ctx: c, user } = setup();
    expect(() =>
      writeTx(c, () =>
        grantPurchased(c, user.id, 1, { type: "permission", permission: SECRET_FLAG, value: 3 }),
      ),
    ).toThrow(ValidationError);
    expect(() =>
      writeTx(c, () => grantPurchased(c, user.id, 1, { type: "permission", permission: QUOTA })),
    ).toThrow(ValidationError);
    expect(() =>
      writeTx(c, () => grantPurchased(c, user.id, 1, { type: "permission", permission: "x.y" })),
    ).toThrow(ValidationError);
    expect(c.sqlite.prepare("SELECT 1 FROM shop_permission_grants").get()).toBeNull();
  });

  test("grantPurchased and revokePurchased require a transaction", () => {
    const { ctx: c, user } = setup();
    expect(() =>
      grantPurchased(c, user.id, 1, { type: "permission", permission: SECRET_FLAG }),
    ).toThrow();
    expect(() => revokePurchased(c, 1)).toThrow();
  });
});
