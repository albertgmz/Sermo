import type * as z from "zod";
import { type Actor, GUEST, requireAuthenticated } from "../../actor";
import { type Ctx, prepared } from "../../context";
import type { GlobalPermissions } from "../../contracts/auth";
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
import { implement } from "../../operation";
import {
  combinationsGranting,
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
  permissionsOf,
  requirePermission,
} from "../../permissions";
import { appendModeratorLog } from "../moderation";

export type { NodeTree, NodeTreeEntry } from "../../permissions";
export { getNodeTree, viewableNodeIds } from "../../permissions";
export interface NodeAccess {
  view: boolean;
  post: boolean;
  moderate: boolean;
}
export type GlobalPermissionsValue = z.infer<typeof GlobalPermissions>;
type GroupRow = {
  id: number;
  title: string;
  description: string;
  rank: number;
  user_title: string;
  badge: string;
  builtin: "guest" | "unconfirmed" | "registered" | "moderator" | "admin" | null;
};
type EntryRow = {
  group_id: number;
  user_id: number;
  node_id: number;
  permission: string;
  value: number;
  type: "flag" | "integer";
};
const groupValue = (g: GroupRow) => ({
  id: g.id,
  title: g.title,
  description: g.description,
  rank: g.rank,
  userTitle: g.user_title,
  badge: g.badge,
  builtin: g.builtin,
});
const getGroup = (ctx: Ctx, id: number) =>
  prepared(ctx, "permissions.group", () =>
    ctx.sqlite.prepare<GroupRow, [number]>(
      "SELECT id, title, description, rank, user_title, badge, builtin FROM groups WHERE id = ?1",
    ),
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
const assertRank = (rank: number, ceiling: number) => {
  if (rank >= ceiling) throw new ForbiddenError();
};
const assertAdministrator = (ctx: Ctx) => {
  const ids = combinationsGranting(ctx, "admin.permissions");
  if (
    !ids.length ||
    !prepared(ctx, "permissions.activeAdministrator", () =>
      ctx.sqlite.prepare<{ id: number }, [string, number]>(
        "SELECT id FROM users WHERE permission_combination_id IN (SELECT value FROM json_each(?1)) AND banned_permanently = 0 AND (banned_until IS NULL OR banned_until <= ?2) LIMIT 1",
      ),
    ).get(JSON.stringify(ids), ctx.now())
  )
    throw new ConflictError("Cannot remove the last administrator.");
};

export function getNodeAccess(ctx: Ctx, actor: Actor): (nodeId: number) => NodeAccess {
  const permissions = permissionsOf(ctx, actor);
  return (nodeId) => ({
    view: permissions.can("node.view", { nodeId }),
    post: permissions.can("forum.createThread", { nodeId }),
    moderate: permissions.can("forum.deleteAny", { nodeId }),
  });
}
export function getGlobalPermissions(ctx: Ctx, actor: Actor): GlobalPermissionsValue {
  const permissions = permissionsOf(ctx, actor);
  return {
    isAdmin: permissions.can("admin.permissions"),
    isModerator: permissions.can("moderation.access"),
    canViewProfiles: permissions.can("profile.view"),
    canPostProfile: permissions.can("profilePost.post"),
    canStartConversations: permissions.can("conversation.start"),
    canReact: permissions.can("reaction.react"),
  };
}
export function requireAdmin(ctx: Ctx, actor: Actor): void {
  requirePermission(ctx, actor, "admin.permissions");
}

export const groupsListOp = implement(groupsList, (ctx, actor) => {
  admin(ctx, actor, "admin.groups");
  return {
    items: prepared(ctx, "permissions.groups", () =>
      ctx.sqlite.prepare<GroupRow, []>(
        "SELECT id, title, description, rank, user_title, badge, builtin FROM groups ORDER BY rank DESC, id",
      ),
    )
      .all()
      .map(groupValue),
  };
});
export const groupsGetOp = implement(groupsGet, (ctx, actor, input) => {
  admin(ctx, actor, "admin.groups");
  const group = getGroup(ctx, input.groupId);
  if (!group) throw new NotFoundError();
  return groupValue(group);
});
export const groupsCreateOp = implement(groupsCreate, (ctx, actor, input) => {
  admin(ctx, actor, "admin.groups");
  return writeTx(ctx, () => {
    assertRank(input.rank, memberStanding(ctx, actor).maxRank);
    const id = Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO groups (title, description, rank, user_title, badge) VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .run(input.title, input.description, input.rank, input.userTitle, input.badge)
        .lastInsertRowid,
    );
    appendModeratorLog(ctx, actor, "group.create", "group", id);
    return groupValue(getGroup(ctx, id)!);
  });
});
export const groupsUpdateOp = implement(groupsUpdate, (ctx, actor, input) => {
  admin(ctx, actor, "admin.groups");
  return writeTx(ctx, () => {
    const old = getGroup(ctx, input.groupId);
    if (!old) throw new NotFoundError();
    const ceiling = memberStanding(ctx, actor).maxRank;
    assertRank(old.rank, ceiling);
    assertRank(input.rank ?? old.rank, ceiling);
    ctx.sqlite
      .prepare(
        "UPDATE groups SET title = ?1, description = ?2, rank = ?3, user_title = ?4, badge = ?5 WHERE id = ?6",
      )
      .run(
        input.title ?? old.title,
        input.description ?? old.description,
        input.rank ?? old.rank,
        input.userTitle ?? old.user_title,
        input.badge ?? old.badge,
        old.id,
      );
    appendModeratorLog(ctx, actor, "group.update", "group", old.id);
    return groupValue(getGroup(ctx, old.id)!);
  });
});
export const groupsDeleteOp = implement(groupsDelete, (ctx, actor, input) => {
  admin(ctx, actor, "admin.groups");
  return writeTx(ctx, () => {
    const group = getGroup(ctx, input.groupId);
    if (!group) throw new NotFoundError();
    if (group.builtin) throw new ConflictError("Built-in groups cannot be deleted.");
    assertRank(group.rank, memberStanding(ctx, actor).maxRank);
    ctx.sqlite.prepare("UPDATE users SET group_id = 2 WHERE group_id = ?1").run(group.id);
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
  const list = (table: "user_groups" | "user_group_grants") =>
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
    displayGroupId: standing.displayGroupId,
    rank: standing.maxRank,
  };
};
export const usersGetGroupsOp = implement(usersGetGroups, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.members", { target: GUEST });
  requirePermission(ctx, actor, "admin.members", { target: getMember(ctx, input.userId) });
  return memberGroups(ctx, input.userId);
});
export const usersSetGroupsOp = implement(usersSetGroups, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.members", { target: GUEST });
  return writeTx(ctx, () => {
    const target = getMember(ctx, input.userId);
    requirePermission(ctx, actor, "admin.members", { target });
    const ids = [input.primaryGroupId, ...(input.secondaryGroupIds ?? [])].filter(
      (id): id is number => id !== undefined,
    );
    if (ids.includes(GROUP_IDS.guest))
      throw new ValidationError("The Guest group cannot be assigned.");
    const ceiling = memberStanding(ctx, actor).maxRank;
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
    assertAdministrator(ctx);
    appendModeratorLog(ctx, actor, "user.groups", "user", input.userId);
    return memberGroups(ctx, input.userId);
  });
});

export const permissionsDefinitionsOp = implement(permissionsDefinitions, (ctx, actor) => {
  admin(ctx, actor, "admin.permissions");
  return {
    items: PERMISSION_IDS.map((id) => {
      const def: PermissionDefinition = PERMISSIONS[id];
      return {
        id,
        scope: def.scope,
        type: def.type,
        category: def.category,
        unit: def.type === "integer" ? def.unit : null,
        ...permissionPhrases(id),
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
});
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
export const permissionsListOp = implement(permissionsList, (ctx, actor, input) => {
  admin(ctx, actor, "admin.permissions");
  const { groupId, userId, nodeId } = validateTarget(ctx, input);
  return entrySet(ctx, groupId, userId, nodeId);
});
export const permissionsSetOp = implement(permissionsSet, (ctx, actor, input) => {
  admin(ctx, actor, "admin.permissions");
  return writeTx(ctx, () => {
    const { groupId, userId, nodeId } = validateTarget(ctx, input);
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
    if (input.entries.some((entry) => entry.permission === "admin.permissions"))
      assertAdministrator(ctx);
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
export const permissionsListNodeOp = implement(permissionsListNode, (ctx, actor, input) => {
  admin(ctx, actor, "admin.permissions");
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
});
export const permissionsExplainOp = implement(permissionsExplain, (ctx, actor, input) => {
  admin(ctx, actor, "admin.permissions");
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
  const target = input.targetUserId === undefined ? undefined : getMember(ctx, input.targetUserId);
  return explainPermission(ctx, subject, input.permission as keyof typeof PERMISSIONS, {
    nodeId: input.nodeId,
    ownerId: input.ownerId,
    createdAt: input.createdAt === undefined ? undefined : Date.parse(input.createdAt),
    target,
    threadBanned: input.threadBanned,
  });
});
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
