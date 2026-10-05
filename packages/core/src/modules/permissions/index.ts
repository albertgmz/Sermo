import type * as z from "zod";
import type { Actor } from "../../actor";
import { actorGroupId, requireAuthenticated } from "../../actor";
import { type Ctx, cached, invalidate, prepared } from "../../context";
import type { GlobalPermissions } from "../../contracts/auth";
import {
  groupsList,
  groupsUpdate,
  permissionsListNode,
  permissionsSetNode,
  usersSetGroup,
} from "../../contracts/permissions";
import { GROUP_IDS } from "../../db/schema";
import { writeTx } from "../../db/tx";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { implement } from "../../operation";
import { appendModeratorLog } from "../moderation";

export interface NodeTreeEntry {
  id: number;
  parentId: number | null;
  type: "category" | "forum";
  title: string;
  description: string;
  position: number;
  depth: number;
}
export interface NodeTree {
  readonly entries: readonly NodeTreeEntry[];
  get(id: number): NodeTreeEntry | undefined;
  ancestors(id: number): readonly NodeTreeEntry[];
  subtreeIds(id: number): readonly number[];
}
export interface NodeAccess {
  view: boolean;
  post: boolean;
  moderate: boolean;
}
export type GlobalPermissionsValue = z.infer<typeof GlobalPermissions>;
type GroupRow = {
  id: number;
  title: string;
  is_admin: number;
  is_moderator: number;
  can_view_nodes: number;
  can_post: number;
  can_view_profiles: number;
  can_post_profile: number;
  can_start_conversations: number;
  can_react: number;
};
type OverrideRow = {
  node_id: number;
  group_id: number;
  can_view: number | null;
  can_post: number | null;
  can_moderate: number | null;
};
const denied: NodeAccess = Object.freeze({ view: false, post: false, moderate: false });
const groupRows = (ctx: Ctx) =>
  prepared(ctx, "permissions.groups", () =>
    ctx.sqlite.prepare<GroupRow, []>("SELECT * FROM groups ORDER BY id"),
  ).all();
const groupValue = (g: GroupRow) => ({
  id: g.id,
  title: g.title,
  isAdmin: !!g.is_admin,
  isModerator: !!g.is_moderator,
  canViewNodes: !!g.can_view_nodes,
  canPost: !!g.can_post,
  canViewProfiles: !!g.can_view_profiles,
  canPostProfile: !!g.can_post_profile,
  canStartConversations: !!g.can_start_conversations,
  canReact: !!g.can_react,
});
const overrideValue = (r: OverrideRow) => ({
  nodeId: r.node_id,
  groupId: r.group_id,
  canView: r.can_view == null ? null : !!r.can_view,
  canPost: r.can_post == null ? null : !!r.can_post,
  canModerate: r.can_moderate == null ? null : !!r.can_moderate,
});

export function getNodeTree(ctx: Ctx): NodeTree {
  return cached(ctx, "node_tree", () => {
    const rows = ctx.sqlite
      .prepare<Omit<NodeTreeEntry, "depth">, []>(
        "SELECT id, parent_id AS parentId, type, title, description, position FROM nodes ORDER BY position, id",
      )
      .all();
    const children = new Map<number | null, typeof rows>();
    for (const row of rows) {
      const list = children.get(row.parentId) ?? [];
      list.push(row);
      children.set(row.parentId, list);
    }
    const entries: NodeTreeEntry[] = [];
    const byId = new Map<number, NodeTreeEntry>();
    const walk = (parent: number | null, depth: number) => {
      for (const row of children.get(parent) ?? []) {
        const entry = { ...row, depth };
        entries.push(entry);
        byId.set(entry.id, entry);
        walk(entry.id, depth + 1);
      }
    };
    walk(null, 0);
    return {
      entries,
      get: (id: number) => byId.get(id),
      ancestors(id: number) {
        const result: NodeTreeEntry[] = [];
        let parent = byId.get(id)?.parentId;
        while (parent != null) {
          const entry = byId.get(parent);
          if (!entry) break;
          result.unshift(entry);
          parent = entry.parentId;
        }
        return result;
      },
      subtreeIds(id: number) {
        if (!byId.has(id)) return [];
        const result: number[] = [];
        const visit = (nodeId: number) => {
          result.push(nodeId);
          for (const child of children.get(nodeId) ?? []) visit(child.id);
        };
        visit(id);
        return result;
      },
    };
  });
}

type PermissionCache = {
  tree: NodeTree;
  globals: Map<number, GlobalPermissionsValue>;
  nodes: Map<number, Map<number, NodeAccess>>;
};
function permissionCache(ctx: Ctx): PermissionCache {
  const tree = getNodeTree(ctx);
  const build = (): PermissionCache => {
    const overrides = ctx.sqlite
      .prepare<OverrideRow, []>(
        "SELECT node_id, group_id, can_view, can_post, can_moderate FROM node_permissions",
      )
      .all();
    const byGroup = new Map<number, Map<number, OverrideRow>>();
    for (const row of overrides) {
      const map = byGroup.get(row.group_id) ?? new Map();
      map.set(row.node_id, row);
      byGroup.set(row.group_id, map);
    }
    const globals = new Map<number, GlobalPermissionsValue>();
    const nodes = new Map<number, Map<number, NodeAccess>>();
    for (const group of groupRows(ctx)) {
      const guest = group.id === GROUP_IDS.guest;
      const admin = !guest && !!group.is_admin;
      globals.set(group.id, {
        isAdmin: admin,
        isModerator: admin || (!guest && !!group.is_moderator),
        canViewProfiles: admin || !!group.can_view_profiles,
        canPostProfile: !guest && (admin || !!group.can_post_profile),
        canStartConversations: !guest && (admin || !!group.can_start_conversations),
        canReact: !guest && (admin || !!group.can_react),
      });
      const access = new Map<number, NodeAccess>();
      const raw = new Map<number, NodeAccess>();
      for (const node of tree.entries) {
        const parentRaw = node.parentId == null ? undefined : raw.get(node.parentId);
        const parentAccess = node.parentId == null ? undefined : access.get(node.parentId);
        const override = byGroup.get(group.id)?.get(node.id);
        const values = {
          view:
            override?.can_view == null
              ? (parentRaw?.view ?? !!group.can_view_nodes)
              : !!override.can_view,
          post:
            override?.can_post == null
              ? (parentRaw?.post ?? !!group.can_post)
              : !!override.can_post,
          moderate:
            override?.can_moderate == null
              ? (parentRaw?.moderate ?? !!group.is_moderator)
              : !!override.can_moderate,
        };
        raw.set(node.id, values);
        const view = admin || (values.view && (parentAccess?.view ?? true));
        access.set(node.id, {
          view,
          post: admin || (!guest && view && values.post),
          moderate: admin || (!guest && view && values.moderate),
        });
      }
      nodes.set(group.id, access);
    }
    return { tree, globals, nodes };
  };
  const result = cached(ctx, "permissions", build);
  if (result.tree === tree) return result;
  const refreshed = build();
  const entry = ctx.caches.get("permissions");
  if (entry) entry.value = refreshed;
  return refreshed;
}
export function getNodeAccess(ctx: Ctx, actor: Actor): (nodeId: number) => NodeAccess {
  const access = permissionCache(ctx).nodes.get(actorGroupId(actor));
  return (nodeId) => access?.get(nodeId) ?? denied;
}
export function getGlobalPermissions(ctx: Ctx, actor: Actor): GlobalPermissionsValue {
  return (
    permissionCache(ctx).globals.get(actorGroupId(actor)) ?? {
      isAdmin: false,
      isModerator: false,
      canViewProfiles: false,
      canPostProfile: false,
      canStartConversations: false,
      canReact: false,
    }
  );
}
export function viewableNodeIds(ctx: Ctx, actor: Actor): readonly number[] {
  const cache = permissionCache(ctx);
  const access = cache.nodes.get(actorGroupId(actor));
  return cache.tree.entries.filter((entry) => access?.get(entry.id)?.view).map((entry) => entry.id);
}
export function requireAdmin(ctx: Ctx, actor: Actor): void {
  requireAuthenticated(actor);
  if (!getGlobalPermissions(ctx, actor).isAdmin) throw new ForbiddenError();
}

export const groupsListOp = implement(groupsList, (ctx, actor) => {
  requireAdmin(ctx, actor);
  return { items: groupRows(ctx).map(groupValue) };
});
export const groupsUpdateOp = implement(groupsUpdate, (ctx, actor, input) => {
  requireAdmin(ctx, actor);
  return writeTx(ctx, () => {
    const previous = groupRows(ctx).find((g) => g.id === input.groupId);
    if (!previous) throw new NotFoundError();
    const editable = new Set([
      "title",
      "isAdmin",
      "isModerator",
      "canViewNodes",
      "canPost",
      "canViewProfiles",
      "canPostProfile",
      "canStartConversations",
      "canReact",
    ]);
    const changes = Object.fromEntries(
      Object.entries(input).filter(([key, value]) => editable.has(key) && value !== undefined),
    );
    const next = { ...groupValue(previous), ...changes };
    if (
      input.groupId === GROUP_IDS.guest &&
      (next.isAdmin ||
        next.isModerator ||
        next.canPost ||
        next.canPostProfile ||
        next.canStartConversations ||
        next.canReact)
    )
      throw new ValidationError("The Guest group cannot receive those permissions.");
    if (previous.is_admin && !next.isAdmin) {
      const other = ctx.sqlite
        .prepare<{ id: number }, [number]>(
          "SELECT u.id FROM users u JOIN groups g ON g.id = u.group_id WHERE g.is_admin = 1 AND g.id != ?1 LIMIT 1",
        )
        .get(input.groupId);
      const member = ctx.sqlite
        .prepare<{ id: number }, [number]>("SELECT id FROM users WHERE group_id = ?1 LIMIT 1")
        .get(input.groupId);
      if (member && !other) throw new ConflictError("Cannot remove the last administrator.");
    }
    ctx.sqlite
      .prepare(
        "UPDATE groups SET title = ?1, is_admin = ?2, is_moderator = ?3, can_view_nodes = ?4, can_post = ?5, can_view_profiles = ?6, can_post_profile = ?7, can_start_conversations = ?8, can_react = ?9 WHERE id = ?10",
      )
      .run(
        next.title,
        Number(next.isAdmin),
        Number(next.isModerator),
        Number(next.canViewNodes),
        Number(next.canPost),
        Number(next.canViewProfiles),
        Number(next.canPostProfile),
        Number(next.canStartConversations),
        Number(next.canReact),
        input.groupId,
      );
    invalidate(ctx, "permissions");
    appendModeratorLog(ctx, actor, "group.update", "group", input.groupId);
    return next;
  });
});
export const usersSetGroupOp = implement(usersSetGroup, (ctx, actor, input) => {
  requireAdmin(ctx, actor);
  if (input.groupId === GROUP_IDS.guest)
    throw new ValidationError("The Guest group cannot be assigned.");
  return writeTx(ctx, () => {
    const user = ctx.sqlite
      .prepare<{ group_id: number }, [number]>("SELECT group_id FROM users WHERE id = ?1")
      .get(input.userId);
    const target = groupRows(ctx).find((g) => g.id === input.groupId);
    if (!user || !target) throw new NotFoundError();
    const source = groupRows(ctx).find((g) => g.id === user.group_id);
    if (source?.is_admin && !target.is_admin) {
      const other = ctx.sqlite
        .prepare<{ id: number }, [number]>(
          "SELECT u.id FROM users u JOIN groups g ON g.id = u.group_id WHERE g.is_admin = 1 AND u.id != ?1 LIMIT 1",
        )
        .get(input.userId);
      if (!other) throw new ConflictError("Cannot remove the last administrator.");
    }
    ctx.sqlite
      .prepare("UPDATE users SET group_id = ?1 WHERE id = ?2")
      .run(input.groupId, input.userId);
    appendModeratorLog(ctx, actor, "user.group", "user", input.userId, "", {
      groupId: input.groupId,
    });
    return { ok: true };
  });
});
export const permissionsListNodeOp = implement(permissionsListNode, (ctx, actor, input) => {
  requireAdmin(ctx, actor);
  if (!getNodeTree(ctx).get(input.nodeId)) throw new NotFoundError();
  return {
    items: prepared(ctx, "permissions.listNode", () =>
      ctx.sqlite.prepare<OverrideRow, [number]>(
        "SELECT node_id, group_id, can_view, can_post, can_moderate FROM node_permissions WHERE node_id = ?1 ORDER BY group_id",
      ),
    )
      .all(input.nodeId)
      .map(overrideValue),
  };
});
export const permissionsSetNodeOp = implement(permissionsSetNode, (ctx, actor, input) => {
  requireAdmin(ctx, actor);
  if (input.groupId === GROUP_IDS.guest && (input.canPost === true || input.canModerate === true))
    throw new ValidationError("Guests cannot post or moderate.");
  return writeTx(ctx, () => {
    if (!getNodeTree(ctx).get(input.nodeId) || !groupRows(ctx).some((g) => g.id === input.groupId))
      throw new NotFoundError();
    if (input.canView == null && input.canPost == null && input.canModerate == null)
      ctx.sqlite
        .prepare("DELETE FROM node_permissions WHERE node_id = ?1 AND group_id = ?2")
        .run(input.nodeId, input.groupId);
    else
      ctx.sqlite
        .prepare(
          "INSERT INTO node_permissions (node_id, group_id, can_view, can_post, can_moderate) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (node_id, group_id) DO UPDATE SET can_view = excluded.can_view, can_post = excluded.can_post, can_moderate = excluded.can_moderate",
        )
        .run(
          input.nodeId,
          input.groupId,
          input.canView == null ? null : Number(input.canView),
          input.canPost == null ? null : Number(input.canPost),
          input.canModerate == null ? null : Number(input.canModerate),
        );
    invalidate(ctx, "permissions");
    appendModeratorLog(ctx, actor, "node.permission", "node", input.nodeId, "", {
      groupId: input.groupId,
    });
    return input;
  });
});
export const operations = [
  groupsListOp,
  groupsUpdateOp,
  usersSetGroupOp,
  permissionsListNodeOp,
  permissionsSetNodeOp,
];
