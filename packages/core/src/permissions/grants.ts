/**
 * Permissions and groups a member holds through a shop item. This is the only writer of
 * `shop_permission_grants` and `shop_group_grants`; triggers on those tables keep the member's
 * combination and the permission caches correct, so a grant takes effect on the member's next
 * request and stops applying as soon as it is revoked.
 *
 * A purchased permission is a layer of its own in the member's combination (see state.ts): it
 * adds to what the member's groups grant, a `never` anywhere still denies it, and bans and
 * restrictions still override it. A node-scoped permission is granted on every node. A purchased
 * group is one more secondary group.
 *
 * Administration is never for sale: an `admin` permission cannot be sold, nor a group that
 * holds `admin.permissions`. Otherwise the last administrator could be someone whose access
 * ends when an item expires.
 */
import type { Ctx } from "../context";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { PERMISSIONS, type PermissionDefinition, type PermissionId } from "./registry";

export type PurchasedGrant =
  | {
      type: "permission";
      permission: string;
      /** Integer permissions only: the value granted, -1 meaning unlimited. */
      value?: number | undefined;
    }
  | { type: "group"; groupId: number };

/** Whether member ?1 belongs to group ?2 through any source. */
const HELD_SQL =
  "SELECT (EXISTS (SELECT 1 FROM users WHERE id = ?1 AND group_id = ?2) " +
  "OR EXISTS (SELECT 1 FROM user_groups WHERE user_id = ?1 AND group_id = ?2) " +
  "OR EXISTS (SELECT 1 FROM user_group_grants WHERE user_id = ?1 AND group_id = ?2) " +
  "OR EXISTS (SELECT 1 FROM shop_group_grants WHERE user_id = ?1 AND group_id = ?2)) AS held";

/** The stored value of a permission grant; throws ValidationError when the grant is malformed. */
function permissionGrantValue(grant: Extract<PurchasedGrant, { type: "permission" }>): number {
  if (!Object.hasOwn(PERMISSIONS, grant.permission))
    throw new ValidationError(`Unknown permission: ${grant.permission}`);
  const def: PermissionDefinition = PERMISSIONS[grant.permission as PermissionId];
  if (def.category === "admin")
    throw new ValidationError("Administration permissions cannot be sold.");
  if (def.type === "flag") {
    if (grant.value !== undefined)
      throw new ValidationError(`Permission ${grant.permission} is yes/no and takes no value.`);
    return 1;
  }
  if (grant.value === undefined || !Number.isInteger(grant.value) || grant.value < -1)
    throw new ValidationError(
      `Permission ${grant.permission} needs an integer value (-1 for unlimited).`,
    );
  return grant.value;
}

/**
 * Checks that a grant can be sold: a registered permission with a value of the right kind, or an
 * existing group other than the guest group. Call it when an item is created or changed.
 */
export function validatePurchasedGrant(ctx: Ctx, grant: PurchasedGrant): void {
  if (grant.type === "permission") {
    permissionGrantValue(grant);
    return;
  }
  const group = ctx.sqlite
    .prepare<{ builtin: string | null }, [number]>("SELECT builtin FROM groups WHERE id = ?1")
    .get(grant.groupId);
  if (!group) throw new NotFoundError();
  if (group.builtin === "guest") throw new ValidationError("The guest group cannot be sold.");
  if (groupAdministers(ctx, grant.groupId))
    throw new ValidationError("A group that administers permissions cannot be sold.");
}

function groupAdministers(ctx: Ctx, groupId: number): boolean {
  return !!ctx.sqlite
    .prepare<{ id: number }, [number]>(
      "SELECT e.id FROM permission_entries e JOIN permission_definitions d ON d.id = e.permission_id " +
        "WHERE d.key = 'admin.permissions' AND e.group_id = ?1 AND e.user_id = 0 AND e.node_id = 0 AND e.value = 1",
    )
    .get(groupId);
}

/**
 * Gives `userId` the grant for as long as inventory row `inventoryId` holds it. Call inside the
 * write transaction of the purchase. Granting the same thing twice for one inventory row does
 * nothing. A group that has come to administer permissions since the item was created is
 * refused with ConflictError. Returns whether the member's groups changed (the caller then publishes
 * `member.groups_changed`).
 */
export function grantPurchased(
  ctx: Ctx,
  userId: number,
  inventoryId: number,
  grant: PurchasedGrant,
): { groupAdded: boolean } {
  if (!ctx.sqlite.inTransaction) throw new Error("grantPurchased requires a write transaction");
  if (grant.type === "group") {
    if (groupAdministers(ctx, grant.groupId))
      throw new ConflictError("This item cannot be bought at the moment.");
    const held = ctx.sqlite
      .prepare<{ held: number }, [number, number]>(HELD_SQL)
      .get(userId, grant.groupId)!.held;
    ctx.sqlite
      .prepare(
        "INSERT OR IGNORE INTO shop_group_grants (user_id, inventory_id, group_id, created_at) VALUES (?1, ?2, ?3, ?4)",
      )
      .run(userId, inventoryId, grant.groupId, ctx.now());
    return { groupAdded: !held };
  }
  const value = permissionGrantValue(grant);
  const definition = ctx.sqlite
    .prepare<{ id: number }, [string]>("SELECT id FROM permission_definitions WHERE key = ?1")
    .get(grant.permission);
  if (!definition) throw new Error(`Permission ${grant.permission} is not stored yet.`);
  ctx.sqlite
    .prepare(
      "INSERT OR IGNORE INTO shop_permission_grants (user_id, inventory_id, permission_id, value, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    )
    .run(userId, inventoryId, definition.id, value, ctx.now());
  return { groupAdded: false };
}

/**
 * Removes everything inventory row `inventoryId` granted (it expired, or its last unit was
 * used). Call inside a write transaction. Returns the groups the member no longer belongs to
 * through any source, for `member.groups_changed`.
 */
export function revokePurchased(ctx: Ctx, inventoryId: number): { groupsRemoved: number[] } {
  if (!ctx.sqlite.inTransaction) throw new Error("revokePurchased requires a write transaction");
  ctx.sqlite.prepare("DELETE FROM shop_permission_grants WHERE inventory_id = ?1").run(inventoryId);
  const removed = ctx.sqlite
    .prepare<{ user_id: number; group_id: number }, [number]>(
      "DELETE FROM shop_group_grants WHERE inventory_id = ?1 RETURNING user_id, group_id",
    )
    .all(inventoryId);
  const stillHeld = ctx.sqlite.prepare<{ held: number }, [number, number]>(HELD_SQL);
  return {
    groupsRemoved: removed
      .filter((row) => !stillHeld.get(row.user_id, row.group_id)!.held)
      .map((row) => row.group_id),
  };
}
