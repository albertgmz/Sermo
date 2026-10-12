import type { Actor } from "../../actor";
import type { Ctx } from "../../context";
import {
  type FlagPermissionId,
  getNodeTree,
  PERMISSION_IDS,
  PERMISSIONS,
  type PermissionDefinition,
  permissionState,
  requestVersions,
  resolvedPermissions,
} from "../../permissions";
import { combinationById } from "../../permissions/state";

/** Most forums `moderatedNodeIds` lists. */
export const MODERATED_NODES_LIMIT = 500;

const flagsWhere = (keep: (id: FlagPermissionId) => boolean) =>
  PERMISSION_IDS.filter(
    (id): id is FlagPermissionId => PERMISSIONS[id].type === "flag" && keep(id as FlagPermissionId),
  );

/**
 * What a moderator may do inside a forum: the node-scoped flags of moderators. The registry
 * marks them with the legacy `is_moderator` flag (they sit in the `forum` category, beside the
 * ones everybody holds), or with the `moderation` category.
 */
export const NODE_MODERATION = flagsWhere((id) => {
  const def: PermissionDefinition = PERMISSIONS[id];
  return def.scope === "node" && (def.category === "moderation" || def.legacy === "is_moderator");
});

const MODERATION_IDS: ReadonlySet<string> = new Set(NODE_MODERATION);

/** Permissions of the `moderation` and `admin` categories that apply everywhere. */
export const GLOBAL_STAFF = flagsWhere((id) => {
  const def: PermissionDefinition = PERMISSIONS[id];
  return def.scope === "global" && (def.category === "moderation" || def.category === "admin");
});

/** Permissions of the `admin` category. */
export const ADMIN_PERMISSIONS = flagsWhere((id) => PERMISSIONS[id].category === "admin");

export interface StaffAccess {
  panel: boolean;
  moderatesEverywhere: boolean;
  moderatedNodeIds: number[];
}

const NOTHING: StaffAccess = Object.freeze({
  panel: false,
  moderatesEverywhere: false,
  moderatedNodeIds: [],
});

export interface NodeModeration {
  everywhere: boolean;
  nodeIds: number[];
}

/** Per context, the forums a permission combination moderates, until the permissions or tree change. */
const moderated = new WeakMap<Ctx, Map<string, NodeModeration>>();
const CACHE_LIMIT = 1000;

/**
 * Where the actor moderates. A member whose layers hold no allowing entry for a moderator
 * permission moderates nowhere, which is decided from the in-memory state alone. Otherwise each
 * forum is resolved in memory (never a query): `everywhere` when they hold one through a global
 * entry and nothing takes it away on any forum.
 */
export function moderationOf(ctx: Ctx, actor: Exclude<Actor, { kind: "guest" }>): NodeModeration {
  const principal = actor.principal;
  if (principal && (principal.bannedPermanently || (principal.bannedUntil ?? 0) > ctx.now()))
    return { everywhere: false, nodeIds: [] };
  const versions = requestVersions(ctx, actor);
  const state = permissionState(ctx, versions);
  const combination =
    principal && principal.combinationId > 0
      ? combinationById(state, principal.combinationId)
      : undefined;
  // Whether a global entry grants one; unknown (null) for an actor without a stored principal.
  let hasGlobal: boolean | null = null;
  if (combination) {
    hasGlobal = false;
    let any = false;
    for (const key of combination.layerKeys)
      for (const entry of state.layers.get(key)?.entries ?? [])
        if (entry.value === 1 && MODERATION_IDS.has(entry.permission)) {
          any = true;
          if (entry.nodeId === 0) hasGlobal = true;
        }
    if (!any) return { everywhere: false, nodeIds: [] };
  }

  const key = combination ? `${combination.id}:${versions.permissions}:${versions.nodeTree}` : null;
  const known = key === null ? undefined : moderated.get(ctx)?.get(key);
  if (known) return known;
  const forums = getNodeTree(ctx).entries.filter((entry) => entry.type === "forum");
  const nodeIds = forums
    .filter((entry) => {
      const here = resolvedPermissions(ctx, actor, { nodeId: entry.id });
      return NODE_MODERATION.some((id) => here[id] === true);
    })
    .map((entry) => entry.id);
  const result = {
    everywhere: (hasGlobal ?? nodeIds.length > 0) && nodeIds.length === forums.length,
    nodeIds,
  };
  if (key !== null) {
    const cache = moderated.get(ctx) ?? new Map<string, NodeModeration>();
    moderated.set(ctx, cache);
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(key, result);
  }
  return result;
}

/**
 * What a staff interface needs to build its menu: whether anything of the moderation or
 * administration categories is held anywhere, whether the actor moderates every forum, and
 * otherwise the forums they moderate. `globals` is `resolvedPermissions(ctx, actor)`, which the
 * caller already holds.
 */
export function staffAccess(
  ctx: Ctx,
  actor: Actor,
  globals: Record<string, boolean | number>,
): StaffAccess {
  if (actor.kind === "guest") return NOTHING;
  const heldGlobally = GLOBAL_STAFF.some((id) => globals[id] === true);
  const { everywhere, nodeIds } = moderationOf(ctx, actor);
  return {
    panel: heldGlobally || everywhere || nodeIds.length > 0,
    moderatesEverywhere: everywhere,
    moderatedNodeIds: everywhere ? [] : nodeIds.slice(0, MODERATED_NODES_LIMIT),
  };
}
