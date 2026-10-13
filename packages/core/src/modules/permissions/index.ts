import { type Actor, GUEST, requireAuthenticated } from "../../actor";
import { type Ctx, prepared } from "../../context";
import {
  groupsCreate,
  groupsDelete,
  groupsGet,
  groupsList,
  groupsUpdate,
  permissionsDefinitions,
  permissionsExplain,
  permissionsList,
  permissionsListNode,
  permissionsSet,
  usersGetGroups,
  usersSetGroups,
} from "../../contracts/permissions";
import { GROUP_IDS } from "../../db/schema";
import { writeTx } from "../../db/tx";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { publishEvent } from "../../events";
import { implement } from "../../operation";
import {
  can,
  combinationsGranting,
  currentActor,
  currentVersions,
  explainPermission,
  getNodeTree,
  memberActor,
  memberStanding,
  PERMISSION_IDS,
  PERMISSIONS,
  type PermissionDefinition,
  PRINCIPAL_COLUMNS,
  type PrincipalRow,
  permissionPhrases,
  readWithCurrentActor,
  requirePermission,
  resolvedPermissions,
} from "../../permissions";
import { helpFor, titleFor, viewerLanguage } from "../../shared/language";
import { requireNotErased } from "../admin/erased";
import { confirmActorPassword } from "../admin/shared";
import { appendModeratorLog } from "../moderation";

export type { NodeTree, NodeTreeEntry } from "../../permissions";
export { getNodeTree, viewableNodeIds } from "../../permissions";

type GroupRow = {
  id: number;
  title: string;
  description: string;
  rank: number;
  user_title: string;
  badge: string;
  builtin: "guest" | "unconfirmed" | "registered" | "moderator" | "admin" | null;
  name_color_id: number | null;
  is_staff: number;
};
type CountedGroupRow = GroupRow & { member_count: number };
type EntryRow = {
  group_id: number;
  user_id: number;
  node_id: number;
  permission: string;
  value: number;
  type: "flag" | "integer";
};
const groupValue = (g: GroupRow & { member_count?: number | null }) => ({
  id: g.id,
  title: g.title,
  description: g.description,
  rank: g.rank,
  userTitle: g.user_title,
  badge: g.badge,
  builtin: g.builtin,
  nameColorId: g.name_color_id,
  isStaff: !!g.is_staff,
  memberCount: g.member_count ?? null,
});
/**
 * A group's members: those with it as primary group (index users_group) plus those holding it
 * by hand without it also being their primary group (index user_groups_group, one point lookup
 * on users each). Promotion and shop grants are not counted.
 */
export const groupsSql = {
  plain:
    "SELECT id, title, description, rank, user_title, badge, builtin, name_color_id, is_staff FROM groups",
  counted:
    "SELECT id, title, description, rank, user_title, badge, builtin, name_color_id, is_staff, (SELECT count(*) FROM users u WHERE u.group_id = groups.id) + (SELECT count(*) FROM user_groups ug WHERE ug.group_id = groups.id AND NOT EXISTS (SELECT 1 FROM users p WHERE p.id = ug.user_id AND p.group_id = groups.id)) AS member_count FROM groups",
};
/** A group's name colour must be an active colour of the `name` catalog. */
const requireNameColor = (ctx: Ctx, id: number) => {
  const color = ctx.sqlite
    .prepare<{ kind: string; is_active: number }, [number]>(
      "SELECT kind, is_active FROM palette_colors WHERE id = ?1",
    )
    .get(id);
  if (color?.kind !== "name" || !color.is_active)
    throw new ValidationError("The name colour must be an active colour of the name catalog.");
};
const getGroup = (ctx: Ctx, id: number) =>
  prepared(ctx, "permissions.group", () =>
    ctx.sqlite.prepare<GroupRow, [number]>(
      "SELECT id, title, description, rank, user_title, badge, builtin, name_color_id, is_staff FROM groups WHERE id = ?1",
    ),
  ).get(id);
const getCountedGroup = (ctx: Ctx, id: number) =>
  prepared(ctx, "permissions.groupCounted", () =>
    ctx.sqlite.prepare<CountedGroupRow, [number]>(`${groupsSql.counted} WHERE id = ?1`),
  ).get(id);
const getMember = (ctx: Ctx, id: number) => {
  const row = prepared(ctx, "permissions.member", () =>
    ctx.sqlite.prepare<PrincipalRow & { id: number; group_id: number }, [number]>(
      `SELECT u.id, u.group_id, ${PRINCIPAL_COLUMNS} FROM users u WHERE u.id = ?1`,
    ),
  ).get(id);
  if (!row) throw new NotFoundError();
  return memberActor(row.id, row.group_id, row, currentVersions(ctx));
};
const ensureNode = (ctx: Ctx, id: number) => {
  if (!getNodeTree(ctx).get(id)) throw new NotFoundError();
};
const admin = (ctx: Ctx, actor: Actor, id: "admin.groups" | "admin.permissions") =>
  requirePermission(ctx, actor, id);
/**
 * The same check inside the write transaction, against what is committed now: the request's
 * actor was resolved before the transaction opened. Returns the reloaded actor; every later
 * decision of the operation (rank ceiling, hierarchy) uses it.
 */
/**
 * Reading groups serves every screen that picks one: holding any of these permissions is enough.
 * The resolved permissions apply no member-dependent condition. Otherwise the refusal is the one
 * `admin.groups` gives.
 */
const requireGroupReader = (ctx: Ctx, actor: Actor) => {
  const held = resolvedPermissions(ctx, actor);
  if (
    held["admin.groups"] === true ||
    held["admin.permissions"] === true ||
    held["admin.promotions"] === true ||
    held["admin.members"] === true
  )
    return;
  requirePermission(ctx, actor, "admin.groups");
};
const adminNow = (ctx: Ctx, actor: Actor, id: "admin.groups" | "admin.permissions") => {
  const current = currentActor(ctx, actor);
  requirePermission(ctx, current, id);
  return current;
};
const assertRank = (rank: number, ceiling: number) => {
  if (rank >= ceiling) throw new ForbiddenError();
};
/** Whether a shop item's effect adds this group (the catalog is small; this is an admin path). */
const soldByShop = (ctx: Ctx, groupId: number) =>
  !!ctx.sqlite
    .prepare<{ id: number }, [number]>(
      "SELECT id FROM shop_items WHERE json_extract(effect, '$.type') = 'group' AND json_extract(effect, '$.groupId') = ?1 LIMIT 1",
    )
    .get(groupId);
/**
 * Whether a promotion grants this group: one lists it, or a member still holds it through one
 * (a deleted promotion's grants are removed by a job).
 */
const grantedByPromotion = (ctx: Ctx, groupId: number) =>
  !!ctx.sqlite
    .prepare<{ held: number }, [number]>(
      "SELECT 1 AS held FROM promotions WHERE EXISTS (SELECT 1 FROM json_each(promotions.group_ids) WHERE value = ?1) UNION ALL SELECT 1 FROM user_group_grants WHERE group_id = ?1 LIMIT 1",
    )
    .get(groupId);
/**
 * The invariant every change to permissions, groups, memberships and bans keeps: at least one
 * member who is not banned has `admin.permissions`. Call it inside the write transaction, after
 * the change; it throws ConflictError when the change would leave nobody. When only one member
 * changes, capture their `admin.permissions` before the change, inside the same transaction.
 * Only a member losing that permission needs the full search for another administrator.
 */
export const assertAdministrator = (
  ctx: Ctx,
  affected?: { userId: number; wasAdministrator: boolean },
) => {
  if (
    affected &&
    (!affected.wasAdministrator || can(ctx, getMember(ctx, affected.userId), "admin.permissions"))
  )
    return;
  const ids = JSON.stringify(combinationsGranting(ctx, "admin.permissions"));
  if (
    !prepared(ctx, "permissions.activeAdministrator", () =>
      ctx.sqlite.prepare<{ id: number }, [string, number]>(
        "SELECT id FROM users WHERE permission_combination_id IN (SELECT value FROM json_each(?1)) AND banned_permanently = 0 AND (banned_until IS NULL OR banned_until <= ?2) LIMIT 1",
      ),
    ).get(ids, ctx.now())
  )
    throw new ConflictError("Cannot remove the last administrator.");
};

export const groupsListOp = implement(groupsList, (ctx, actor, input) =>
  readWithCurrentActor(ctx, actor, (current) => {
    requireGroupReader(ctx, current);
    return {
      items: input.counts
        ? prepared(ctx, "permissions.groups", () =>
            ctx.sqlite.prepare<CountedGroupRow, []>(`${groupsSql.counted} ORDER BY rank DESC, id`),
          )
            .all()
            .map(groupValue)
        : prepared(ctx, "permissions.groupsPlain", () =>
            ctx.sqlite.prepare<GroupRow, []>(`${groupsSql.plain} ORDER BY rank DESC, id`),
          )
            .all()
            .map(groupValue),
    };
  }),
);
export const groupsGetOp = implement(groupsGet, (ctx, actor, input) =>
  readWithCurrentActor(ctx, actor, (current) => {
    requireGroupReader(ctx, current);
    const group = getCountedGroup(ctx, input.groupId);
    if (!group) throw new NotFoundError();
    return groupValue(group);
  }),
);
export const groupsCreateOp = implement(groupsCreate, async (ctx, actor, input) => {
  admin(ctx, actor, "admin.groups");
  await confirmActorPassword(ctx, actor, input.actorPassword);
  return writeTx(ctx, () => {
    const current = adminNow(ctx, actor, "admin.groups");
    assertRank(input.rank, memberStanding(ctx, current).maxRank);
    if (input.nameColorId !== null) requireNameColor(ctx, input.nameColorId);
    const id = Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO groups (title, description, rank, user_title, badge, name_color_id, is_staff) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )
        .run(
          input.title,
          input.description,
          input.rank,
          input.userTitle,
          input.badge,
          input.nameColorId,
          Number(input.isStaff),
        ).lastInsertRowid,
    );
    appendModeratorLog(ctx, actor, "group.create", "group", id);
    // A new group has no members.
    return groupValue({ ...getGroup(ctx, id)!, member_count: 0 });
  });
});
export const groupsUpdateOp = implement(groupsUpdate, async (ctx, actor, input) => {
  admin(ctx, actor, "admin.groups");
  await confirmActorPassword(ctx, actor, input.actorPassword);
  const id = writeTx(ctx, () => {
    const current = adminNow(ctx, actor, "admin.groups");
    const old = getGroup(ctx, input.groupId);
    if (!old) throw new NotFoundError();
    const ceiling = memberStanding(ctx, current).maxRank;
    assertRank(old.rank, ceiling);
    assertRank(input.rank ?? old.rank, ceiling);
    const nameColorId = input.nameColorId === undefined ? old.name_color_id : input.nameColorId;
    if (nameColorId !== null && nameColorId !== old.name_color_id)
      requireNameColor(ctx, nameColorId);
    ctx.sqlite
      .prepare(
        "UPDATE groups SET title = ?1, description = ?2, rank = ?3, user_title = ?4, badge = ?5, name_color_id = ?7, is_staff = ?8 WHERE id = ?6",
      )
      .run(
        input.title ?? old.title,
        input.description ?? old.description,
        input.rank ?? old.rank,
        input.userTitle ?? old.user_title,
        input.badge ?? old.badge,
        old.id,
        nameColorId,
        Number(input.isStaff ?? !!old.is_staff),
      );
    appendModeratorLog(ctx, actor, "group.update", "group", old.id);
    return old.id;
  });
  // The members are counted after the write transaction has committed, not inside it.
  const group = getCountedGroup(ctx, id);
  if (!group) throw new NotFoundError();
  return groupValue(group);
});
export const groupsDeleteOp = implement(groupsDelete, async (ctx, actor, input) => {
  admin(ctx, actor, "admin.groups");
  await confirmActorPassword(ctx, actor, input.actorPassword);
  return writeTx(ctx, () => {
    const current = adminNow(ctx, actor, "admin.groups");
    const group = getGroup(ctx, input.groupId);
    if (!group) throw new NotFoundError();
    if (group.builtin) throw new ConflictError("Built-in groups cannot be deleted.");
    const ceiling = memberStanding(ctx, current).maxRank;
    assertRank(group.rank, ceiling);
    // Members hold what they paid for: a group a shop item sells stays until the item goes.
    if (soldByShop(ctx, group.id)) throw new ConflictError("A shop item sells this group.");
    // Its members move to the Member group, which is an assignment like any other: nobody
    // gives out a group ranked at or above their own (the deleter may be one of the members).
    const moved = ctx.sqlite
      .prepare("UPDATE users SET group_id = ?1 WHERE group_id = ?2")
      .run(GROUP_IDS.member, group.id).changes;
    if (moved > 0) assertRank(getGroup(ctx, GROUP_IDS.member)!.rank, ceiling);
    ctx.sqlite.prepare("DELETE FROM user_groups WHERE group_id = ?1").run(group.id);
    ctx.sqlite.prepare("DELETE FROM user_group_grants WHERE group_id = ?1").run(group.id);
    ctx.sqlite.prepare("DELETE FROM permission_entries WHERE group_id = ?1").run(group.id);
    ctx.sqlite
      .prepare(
        "UPDATE promotions SET group_ids = (SELECT coalesce(json_group_array(value), '[]') FROM json_each(promotions.group_ids) WHERE value != ?1) WHERE EXISTS (SELECT 1 FROM json_each(promotions.group_ids) WHERE value = ?1)",
      )
      .run(group.id);
    ctx.sqlite.prepare("DELETE FROM groups WHERE id = ?1").run(group.id);
    assertAdministrator(ctx);
    appendModeratorLog(ctx, actor, "group.delete", "group", group.id);
    return { ok: true };
  });
});

const memberGroups = (ctx: Ctx, userId: number) => {
  const subject = getMember(ctx, userId);
  const standing = memberStanding(ctx, subject);
  const list = (table: "user_groups" | "user_group_grants" | "shop_group_grants") =>
    ctx.sqlite
      .prepare<{ group_id: number }, [number]>(
        `SELECT DISTINCT group_id FROM ${table} WHERE user_id = ?1 ORDER BY group_id`,
      )
      .all(userId)
      .map((r) => r.group_id);
  return {
    userId,
    primaryGroupId: requireAuthenticated(subject).groupId,
    secondaryGroupIds: list("user_groups"),
    promotionGroupIds: list("user_group_grants"),
    purchasedGroupIds: list("shop_group_grants"),
    displayGroupId: standing.displayGroupId,
    rank: standing.maxRank,
  };
};
export const usersGetGroupsOp = implement(usersGetGroups, (ctx, actor, input) =>
  readWithCurrentActor(ctx, actor, (current) => {
    requirePermission(ctx, current, "admin.members", { target: GUEST });
    requirePermission(ctx, current, "admin.members", { target: getMember(ctx, input.userId) });
    return memberGroups(ctx, input.userId);
  }),
);
export const usersSetGroupsOp = implement(usersSetGroups, async (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.members", { target: GUEST });
  await confirmActorPassword(ctx, actor, input.actorPassword);
  return writeTx(ctx, () => {
    const current = currentActor(ctx, actor);
    const target = getMember(ctx, input.userId);
    requirePermission(ctx, current, "admin.members", { target });
    requireNotErased(ctx, input.userId);
    const wasAdministrator = can(ctx, target, "admin.permissions");
    const before = memberGroups(ctx, input.userId);
    const ids = [input.primaryGroupId, ...(input.secondaryGroupIds ?? [])].filter(
      (id): id is number => id !== undefined,
    );
    if (ids.includes(GROUP_IDS.guest))
      throw new ValidationError("The Guest group cannot be assigned.");
    const ceiling = memberStanding(ctx, current).maxRank;
    for (const id of ids) {
      const group = getGroup(ctx, id);
      if (!group) throw new NotFoundError();
      assertRank(group.rank, ceiling);
    }
    if (input.primaryGroupId !== undefined)
      ctx.sqlite
        .prepare("UPDATE users SET group_id = ?1 WHERE id = ?2")
        .run(input.primaryGroupId, input.userId);
    if (input.secondaryGroupIds !== undefined) {
      ctx.sqlite.prepare("DELETE FROM user_groups WHERE user_id = ?1").run(input.userId);
      const insert = ctx.sqlite.prepare(
        "INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, ?2, ?3)",
      );
      for (const id of new Set(input.secondaryGroupIds)) insert.run(input.userId, id, ctx.now());
    }
    assertAdministrator(ctx, { userId: input.userId, wasAdministrator });
    appendModeratorLog(ctx, actor, "user.groups", "user", input.userId);
    const after = memberGroups(ctx, input.userId);
    const oldIds = new Set([
      before.primaryGroupId,
      ...before.secondaryGroupIds,
      ...before.promotionGroupIds,
      ...before.purchasedGroupIds,
    ]);
    const newIds = new Set([
      after.primaryGroupId,
      ...after.secondaryGroupIds,
      ...after.promotionGroupIds,
      ...after.purchasedGroupIds,
    ]);
    const added = [...newIds].filter((id) => !oldIds.has(id));
    const removed = [...oldIds].filter((id) => !newIds.has(id));
    if (added.length || removed.length)
      publishEvent(ctx, {
        type: "member.groups_changed",
        targetType: "user",
        targetId: input.userId,
        payload: {
          added,
          removed,
          source: "admin",
          actorId: actor.kind === "guest" ? null : actor.userId,
        },
      });
    return after;
  });
});

export const permissionsDefinitionsOp = implement(permissionsDefinitions, (ctx, actor) =>
  readWithCurrentActor(ctx, actor, (current) => {
    admin(ctx, current, "admin.permissions");
    const language = viewerLanguage(ctx, current);
    return {
      items: PERMISSION_IDS.map((id) => {
        const def: PermissionDefinition = PERMISSIONS[id];
        const phrases = permissionPhrases(id);
        return {
          id,
          scope: def.scope,
          type: def.type,
          category: def.category,
          unit: def.type === "integer" ? def.unit : null,
          ...phrases,
          title: titleFor(language, phrases.label, id),
          help: helpFor(language, phrases.description),
          categoryTitle: titleFor(language, `permission.category.${def.category}`, def.category),
          defaults: def.defaults,
          requiresAccount: def.type === "flag" && !!def.requiresAccount,
          restriction: def.type === "flag" ? (def.restriction ?? null) : null,
          ownContentOnly: def.type === "flag" && !!def.own,
          timeLimit: def.type === "flag" ? (def.timeLimit ?? null) : null,
          hierarchy: def.type === "flag" && !!def.hierarchy,
          threadBan: def.type === "flag" && !!def.threadBan,
        };
      }),
    };
  }),
);
const targetIds = (input: { groupId?: number; userId?: number; nodeId?: number | null }) => ({
  groupId: input.groupId ?? 0,
  userId: input.userId ?? 0,
  nodeId: input.nodeId ?? 0,
});
const entryValue = (row: EntryRow) =>
  row.type === "integer"
    ? row.value
    : row.value === 1
      ? ("allow" as const)
      : row.value === -1
        ? ("never" as const)
        : ("no" as const);
const entrySet = (ctx: Ctx, groupId: number, userId: number, nodeId: number) => ({
  groupId: groupId || null,
  userId: userId || null,
  nodeId: nodeId || null,
  entries: prepared(ctx, "permissions.entries", () =>
    ctx.sqlite.prepare<EntryRow, [number, number, number]>(
      "SELECT e.group_id, e.user_id, e.node_id, d.key AS permission, e.value, d.value_type AS type FROM permission_entries e JOIN permission_definitions d ON d.id = e.permission_id WHERE e.group_id = ?1 AND e.user_id = ?2 AND e.node_id = ?3 ORDER BY d.id",
    ),
  )
    .all(groupId, userId, nodeId)
    .map((row) => ({ permission: row.permission, value: entryValue(row) })),
});
const validateTarget = (
  ctx: Ctx,
  input: { groupId?: number; userId?: number; nodeId?: number | null },
) => {
  const { groupId, userId, nodeId } = targetIds(input);
  if (!!groupId === !!userId)
    throw new ValidationError("Exactly one of groupId and userId is required.");
  if (groupId && !getGroup(ctx, groupId)) throw new NotFoundError();
  if (userId) getMember(ctx, userId);
  if (nodeId) ensureNode(ctx, nodeId);
  return { groupId, userId, nodeId };
};
export const permissionsListOp = implement(permissionsList, (ctx, actor, input) =>
  readWithCurrentActor(ctx, actor, (current) => {
    admin(ctx, current, "admin.permissions");
    const { groupId, userId, nodeId } = validateTarget(ctx, input);
    return entrySet(ctx, groupId, userId, nodeId);
  }),
);
export const permissionsSetOp = implement(permissionsSet, async (ctx, actor, input) => {
  admin(ctx, actor, "admin.permissions");
  await confirmActorPassword(ctx, actor, input.actorPassword);
  return writeTx(ctx, () => {
    adminNow(ctx, actor, "admin.permissions");
    const { groupId, userId, nodeId } = validateTarget(ctx, input);
    if (userId) requireNotErased(ctx, userId);
    const changesAdministration = input.entries.some(
      (entry) => entry.permission === "admin.permissions",
    );
    const affected =
      userId && changesAdministration
        ? { userId, wasAdministrator: can(ctx, getMember(ctx, userId), "admin.permissions") }
        : undefined;
    const find = prepared(ctx, "permissions.definitionId", () =>
      ctx.sqlite.prepare<{ id: number }, [string]>(
        "SELECT id FROM permission_definitions WHERE key = ?1",
      ),
    );
    const write = prepared(ctx, "permissions.entryUpsert", () =>
      ctx.sqlite.prepare(
        "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (group_id, user_id, node_id, permission_id) DO UPDATE SET value = excluded.value",
      ),
    );
    const remove = prepared(ctx, "permissions.entryDelete", () =>
      ctx.sqlite.prepare(
        "DELETE FROM permission_entries WHERE permission_id = ?1 AND node_id = ?2 AND group_id = ?3 AND user_id = ?4",
      ),
    );
    for (const entry of input.entries) {
      if (!Object.hasOwn(PERMISSIONS, entry.permission))
        throw new ValidationError(`Unknown permission: ${entry.permission}`);
      const def: PermissionDefinition = PERMISSIONS[entry.permission as keyof typeof PERMISSIONS];
      if (nodeId && def.scope === "global")
        throw new ValidationError(`${entry.permission} is global only.`);
      if (entry.value !== "unset") {
        if (
          (def.type === "flag" && typeof entry.value === "number") ||
          (def.type === "integer" && typeof entry.value !== "number")
        )
          throw new ValidationError(`Wrong value type for ${entry.permission}.`);
        if (entry.value === "no" && !nodeId)
          throw new ValidationError("'no' is only valid on nodes.");
        if (typeof entry.value === "number" && (!Number.isInteger(entry.value) || entry.value < -1))
          throw new ValidationError("Integer permission must be at least -1.");
        if (
          groupId === GROUP_IDS.guest &&
          entry.value === "allow" &&
          def.type === "flag" &&
          def.requiresAccount
        )
          throw new ValidationError("Guests cannot receive account-only permissions.");
        // Administration is never sold nor earned. Membership of a group a shop item sells or
        // a promotion grants starts and ends in purchases, expiries and background evaluation
        // that the last-administrator guard never sees, so such a group holds no entry for
        // `admin.permissions`: neither an allow that would end with the membership, nor a
        // never that would begin with it. The promotions and shop modules refuse the reverse
        // order (granting or selling a group that already has one).
        if (groupId && entry.permission === "admin.permissions") {
          // Verification replaces Unconfirmed with Member and must always succeed. The
          // source group cannot decide administration, and the destination cannot deny it,
          // regardless of when an administrator configures either group.
          if (groupId === GROUP_IDS.unconfirmed)
            throw new ConflictError("The Unconfirmed group cannot decide admin.permissions.");
          if (groupId === GROUP_IDS.member && entry.value === "never")
            throw new ConflictError("The Member group cannot deny admin.permissions.");
          if (soldByShop(ctx, groupId)) throw new ConflictError("A shop item sells this group.");
          if (grantedByPromotion(ctx, groupId))
            throw new ConflictError("A promotion grants this group.");
        }
      }
      const definitionId = find.get(entry.permission)!.id;
      if (entry.value === "unset") remove.run(definitionId, nodeId, groupId, userId);
      else
        write.run(
          definitionId,
          nodeId,
          groupId,
          userId,
          typeof entry.value === "number"
            ? entry.value
            : entry.value === "allow"
              ? 1
              : entry.value === "never"
                ? -1
                : 0,
        );
    }
    if (changesAdministration) assertAdministrator(ctx, affected);
    appendModeratorLog(
      ctx,
      actor,
      "permission.set",
      groupId ? "group" : "user",
      groupId || userId,
      "",
      { nodeId, entries: input.entries },
    );
    return entrySet(ctx, groupId, userId, nodeId);
  });
});
export const permissionsListNodeOp = implement(permissionsListNode, (ctx, actor, input) =>
  readWithCurrentActor(ctx, actor, (current) => {
    admin(ctx, current, "admin.permissions");
    ensureNode(ctx, input.nodeId);
    const rows = prepared(ctx, "permissions.nodeEntries", () =>
      ctx.sqlite.prepare<EntryRow, [number]>(
        "SELECT e.group_id, e.user_id, e.node_id, d.key AS permission, e.value, d.value_type AS type FROM permission_entries e JOIN permission_definitions d ON d.id = e.permission_id WHERE e.node_id = ?1 ORDER BY e.group_id, e.user_id, d.id",
      ),
    ).all(input.nodeId);
    const items: ReturnType<typeof entrySet>[] = [];
    for (const row of rows) {
      let current = items.at(-1);
      if (
        !current ||
        current.groupId !== (row.group_id || null) ||
        current.userId !== (row.user_id || null)
      ) {
        current = {
          groupId: row.group_id || null,
          userId: row.user_id || null,
          nodeId: input.nodeId,
          entries: [],
        };
        items.push(current);
      }
      current.entries.push({ permission: row.permission, value: entryValue(row) });
    }
    return { items };
  }),
);
export const permissionsExplainOp = implement(permissionsExplain, (ctx, actor, input) =>
  readWithCurrentActor(ctx, actor, (current) => {
    admin(ctx, current, "admin.permissions");
    if (!Object.hasOwn(PERMISSIONS, input.permission))
      throw new ValidationError(`Unknown permission: ${input.permission}`);
    const def: PermissionDefinition = PERMISSIONS[input.permission as keyof typeof PERMISSIONS];
    const fields = {
      nodeId: def.scope === "node",
      ownerId: def.type === "flag" && !!def.own,
      createdAt: def.type === "flag" && !!def.timeLimit,
      targetUserId: def.type === "flag" && !!def.hierarchy,
      threadBanned: def.type === "flag" && !!def.threadBan,
    };
    for (const [field, required] of Object.entries(fields))
      if (required && input[field as keyof typeof fields] === undefined)
        throw new ValidationError(`${field} is required.`);
    if (input.nodeId) ensureNode(ctx, input.nodeId);
    const subject = input.userId === null ? GUEST : getMember(ctx, input.userId);
    const target =
      input.targetUserId === undefined ? undefined : getMember(ctx, input.targetUserId);
    return explainPermission(ctx, subject, input.permission as keyof typeof PERMISSIONS, {
      nodeId: input.nodeId,
      ownerId: input.ownerId,
      createdAt: input.createdAt === undefined ? undefined : Date.parse(input.createdAt),
      target,
      threadBanned: input.threadBanned,
    });
  }),
);
export const operations = [
  groupsListOp,
  groupsGetOp,
  groupsCreateOp,
  groupsUpdateOp,
  groupsDeleteOp,
  usersGetGroupsOp,
  usersSetGroupsOp,
  permissionsDefinitionsOp,
  permissionsListOp,
  permissionsSetOp,
  permissionsListNodeOp,
  permissionsExplainOp,
];
