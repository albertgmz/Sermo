/**
 * The single place that decides what an actor may do. Services call `can`, `requirePermission`
 * or `permissionValue` with a registry id and the context the permission declares it needs.
 * A check is a lookup in memory: the actor's principal carries its combination id and
 * restrictions, read once when the request's actor was resolved.
 */
import type { Actor, PermissionVersions, Principal } from "../actor";
import { approvalPending } from "../approval";
import type { Ctx } from "../context";
import { GROUP_IDS, RESTRICTION_PERMANENT, type RestrictionKind } from "../db/schema";
import {
  AdultContentError,
  type AdultRefusal,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
} from "../errors";
import { adultRefusalFor } from "./adult";
import {
  type FlagDefinition,
  type FlagPermissionId,
  type IntegerPermissionId,
  PERMISSION_IDS,
  PERMISSIONS,
  type PermissionDefinition,
  type PermissionId,
} from "./registry";
import {
  allCombinations,
  type Combination,
  combinationById,
  combinationKey,
  computeCombination,
  currentVersions,
  flagAt,
  integerAt,
  loadCombinationDef,
  type PermissionState,
  permissionState,
} from "./state";

export interface PermissionContext {
  /** Required by node-scoped permissions. */
  nodeId?: number;
  /** Owner of the content acted on; required by own-content permissions. */
  ownerId?: number;
  /** Creation time (epoch ms) of that content; required by time-limited permissions. */
  createdAt?: number;
  /** The member acted on; required by hierarchy-checked permissions. */
  target?: Actor;
  /** Whether the actor is banned from the thread; required by thread-ban-checked permissions. */
  threadBanned?: boolean;
}

// Principals -------------------------------------------------------------------------------

/**
 * An account waits in the sign-up queue once the site holds it (`signup_review`) and its email is
 * confirmed. One statement of it for every read of `users`; `u.` is the table's alias.
 */
export const AWAITING_SQL = `u.signup_review IS NOT NULL AND u.group_id <> ${GROUP_IDS.unconfirmed}`;
/** What an account that waits for approval keeps whatever it reads as: leaving the forum. */
const AWAITING_KEEPS: ReadonlySet<string> = new Set(["profile.deleteAccount"]);
const AWAITING_COLUMN = `(${AWAITING_SQL}) AS awaiting_approval`;

/** Columns of `users` (aliased `u`) that make up a principal; select them with the member row. */
export const PRINCIPAL_COLUMNS =
  "u.permission_combination_id, u.banned_until, u.banned_permanently, u.restricted_posting_until, " +
  "u.restricted_conversations_until, u.restricted_profile_posts_until, u.created_at, u.post_count, u.is_super_admin, " +
  AWAITING_COLUMN;

export interface PrincipalRow {
  permission_combination_id: number;
  banned_until: number | null;
  banned_permanently: number;
  restricted_posting_until: number | null;
  restricted_conversations_until: number | null;
  restricted_profile_posts_until: number | null;
  created_at: number;
  post_count: number;
  is_super_admin: number;
  awaiting_approval: number;
}

export function principalFromRow(row: PrincipalRow, versions: PermissionVersions): Principal {
  return {
    combinationId: row.permission_combination_id,
    bannedUntil: row.banned_until,
    bannedPermanently: !!row.banned_permanently,
    restrictedPostingUntil: row.restricted_posting_until,
    restrictedConversationsUntil: row.restricted_conversations_until,
    restrictedProfilePostsUntil: row.restricted_profile_posts_until,
    createdAt: row.created_at,
    postCount: row.post_count,
    isSuperAdmin: !!row.is_super_admin,
    awaitingApproval: !!row.awaiting_approval,
    versions,
  };
}

/**
 * An actor for a member loaded with PRINCIPAL_COLUMNS (a notification recipient, the target of
 * a moderation action), so permission checks about them need no further lookup.
 */
export function memberActor(
  userId: number,
  groupId: number,
  row: PrincipalRow,
  versions: PermissionVersions,
): Actor {
  return {
    kind: "user",
    userId,
    groupId,
    sessionId: 0,
    principal: principalFromRow(row, versions),
  };
}

/**
 * The actor as the database describes it now: its primary group, combination, ban and
 * restrictions, with the current cache versions. A request's actor was resolved before its
 * transaction opened, and another process may have changed the member since. Authorization
 * and the protected read or write share that transaction's snapshot, so a revoked member
 * cannot act on what they held a moment ago. Writes must acquire the write lock first.
 */
export function currentActor(ctx: Ctx, actor: Actor): Actor {
  if (!ctx.sqlite.inTransaction) throw new Error("currentActor requires a transaction");
  if (actor.kind === "guest") return { kind: "guest", versions: currentVersions(ctx) };
  const row = ctx.sqlite
    .prepare<PrincipalRow & { group_id: number }, [number]>(
      `SELECT u.group_id, ${PRINCIPAL_COLUMNS} FROM users u WHERE u.id = ?1`,
    )
    .get(actor.userId);
  if (!row) throw new UnauthenticatedError();
  return {
    ...actor,
    groupId: row.group_id,
    principal: principalFromRow(row, currentVersions(ctx)),
  };
}

/** Authorize and read sensitive administration data in one snapshot, without taking a write lock. */
export function readWithCurrentActor<T>(ctx: Ctx, actor: Actor, read: (current: Actor) => T): T {
  // Transactional permission state is deliberately private. Warm the reusable state first;
  // currentActor still reloads versions in the snapshot if another writer commits meanwhile.
  permissionState(ctx);
  return ctx.db.transaction(() => read(currentActor(ctx, actor)), { behavior: "deferred" });
}

interface Resolved {
  readonly principal: Principal | null;
  readonly combination: Combination;
  readonly state: PermissionState;
}

function loadPrincipal(ctx: Ctx, userId: number): Principal | null {
  const row = ctx.sqlite
    .prepare<PrincipalRow, [number]>(`SELECT ${PRINCIPAL_COLUMNS} FROM users u WHERE u.id = ?1`)
    .get(userId);
  return row ? principalFromRow(row, currentVersions(ctx)) : null;
}

function syntheticCombination(
  state: PermissionState,
  userId: number,
  groupIds: number[],
): Combination {
  const key = combinationKey(userId, groupIds);
  const known = state.combinationByKey.get(key);
  if (known !== undefined) {
    const combination = combinationById(state, known);
    if (combination) return combination;
  }
  // Not stored yet (a fixture inserted without triggers); resolve it without caching.
  return computeCombination(state, -1, { userId, groupIds });
}

/**
 * The actor's principal, combination and state. `byGroups` resolves an account that waits for
 * approval by the groups it really holds (to rank it); otherwise it reads as a guest.
 */
function resolve(ctx: Ctx, actor: Actor, byGroups = false): Resolved {
  if (actor.kind === "guest") {
    const state = permissionState(ctx, actor.versions);
    return {
      principal: null,
      combination: syntheticCombination(state, 0, [GROUP_IDS.guest]),
      state,
    };
  }
  const principal = actor.principal ?? loadPrincipal(ctx, actor.userId);
  const state = permissionState(ctx, principal?.versions);
  if (!principal) {
    return { principal, combination: syntheticCombination(state, 0, [actor.groupId]), state };
  }
  // An account waiting for approval reads what a guest reads, whatever groups it holds.
  if (principal.awaitingApproval && !byGroups)
    return { principal, combination: syntheticCombination(state, 0, [GROUP_IDS.guest]), state };
  const id = principal.combinationId;
  let combination = id > 0 ? combinationById(state, id) : undefined;
  if (!combination && id > 0) {
    const def = loadCombinationDef(ctx, state, id);
    if (def)
      combination = ctx.sqlite.inTransaction
        ? computeCombination(state, id, def)
        : combinationById(state, id);
  }
  if (!combination) combination = syntheticCombination(state, 0, [actor.groupId]);
  return { principal, combination, state };
}

// Checks -----------------------------------------------------------------------------------

function isBanned(principal: Principal | null, now: number): boolean {
  if (!principal) return false;
  return (
    principal.bannedPermanently || (principal.bannedUntil !== null && principal.bannedUntil > now)
  );
}

function restrictedUntil(principal: Principal, kind: RestrictionKind): number | null {
  if (kind === "posting") return principal.restrictedPostingUntil;
  if (kind === "conversations") return principal.restrictedConversationsUntil;
  return principal.restrictedProfilePostsUntil;
}

export function isRestricted(principal: Principal, kind: RestrictionKind, now: number): boolean {
  const until = restrictedUntil(principal, kind);
  return until !== null && (until === RESTRICTION_PERMANENT || until > now);
}

function requireContext(id: PermissionId, def: PermissionDefinition, context: PermissionContext) {
  const missing = (field: string) => new Error(`Permission ${id} needs '${field}' in its context.`);
  if (def.scope === "node" && context.nodeId === undefined) throw missing("nodeId");
  if (def.type !== "flag") return;
  if (def.own && context.ownerId === undefined) throw missing("ownerId");
  if (def.timeLimit && context.createdAt === undefined) throw missing("createdAt");
  if (def.hierarchy && context.target === undefined) throw missing("target");
  if (def.threadBan && context.threadBanned === undefined) throw missing("threadBanned");
}

type Denial =
  | "banned"
  | "account"
  | "awaiting"
  | "restricted"
  | "threadBan"
  | "notOwner"
  | "notGranted"
  | "timeLimit"
  | "hierarchy"
  | "adult";

/**
 * `ignoreAdult` answers as if no node were marked +18: for staff management views (which are not
 * content), and to tell whether content would be visible but for its mark.
 */
export type AdultOption = { ignoreAdult?: boolean };

/** Why the actor may not see +18 content, resolved at most once for a set of checks. */
type AdultCheck = () => AdultRefusal | null;

function adultCheck(ctx: Ctx, actor: Actor): AdultCheck {
  let refusal: AdultRefusal | null | undefined;
  return () => {
    if (refusal === undefined) refusal = adultRefusalFor(ctx, actor);
    return refusal;
  };
}

function evaluate(
  ctx: Ctx,
  actor: Actor,
  id: FlagPermissionId,
  context: PermissionContext,
  known?: Resolved,
  adult: AdultCheck = adultCheck(ctx, actor),
): {
  granted: boolean;
  denial?: Denial;
  adult?: AdultRefusal;
  resolved: Resolved;
  nodeIndex: number;
} {
  const def = PERMISSIONS[id] as FlagDefinition;
  requireContext(id, def, context);
  const keeps = AWAITING_KEEPS.has(id);
  const resolved = known && !keeps ? known : resolve(ctx, actor, keeps);
  const nodeIndex =
    def.scope === "node" ? (resolved.state.nodeIndex.get(context.nodeId!) ?? -1) : -1;
  const deny = (denial: Denial) => ({ granted: false, denial, resolved, nodeIndex });
  const now = ctx.now();
  // Bans and restrictions come first and override every grant.
  if (isBanned(resolved.principal, now)) return deny("banned");
  if (def.requiresAccount && actor.kind === "guest") return deny("account");
  if (def.requiresAccount && resolved.principal?.awaitingApproval && !keeps)
    return deny("awaiting");
  if (
    def.restriction &&
    resolved.principal &&
    isRestricted(resolved.principal, def.restriction, now)
  )
    return deny("restricted");
  if (def.threadBan && context.threadBanned) return deny("threadBan");
  if (def.own && (actor.kind === "guest" || context.ownerId !== actor.userId))
    return deny("notOwner");
  if (!flagAt(resolved.combination, id, nodeIndex)) return deny("notGranted");
  if (def.timeLimit) {
    const minutes = integerAt(
      resolved.combination,
      def.timeLimit as IntegerPermissionId,
      nodeIndex,
    );
    if (minutes !== -1 && now - context.createdAt! > minutes * 60_000) return deny("timeLimit");
  }
  if (def.hierarchy) {
    // A waiting account ranks by the groups it holds, not as the guest it reads as.
    const target = resolve(ctx, context.target!, true);
    // A super admin acts on anyone; nobody else acts on a super admin, whatever the ranks.
    if (!resolved.principal?.isSuperAdmin) {
      if (target.principal?.isSuperAdmin) return deny("hierarchy");
      if (resolved.combination.maxRank <= target.combination.maxRank) return deny("hierarchy");
    }
  }
  // Last, so the denial means "granted but for the +18 mark": a node marked +18 (or under one)
  // holds nothing for a viewer who may not see adult content while the mode is on.
  if (nodeIndex >= 0 && resolved.state.tree.entries[nodeIndex]?.adult) {
    const refusal = adult();
    if (refusal) return { granted: false, denial: "adult", adult: refusal, resolved, nodeIndex };
  }
  return { granted: true, resolved, nodeIndex };
}

/** Whether `actor` is a super admin. */
export function isSuperAdmin(ctx: Ctx, actor: Actor): boolean {
  return !!resolve(ctx, actor).principal?.isSuperAdmin;
}

/** Throws unless `actor` is a super admin (a guest gets UnauthenticatedError, others Forbidden). */
export function requireSuperAdmin(ctx: Ctx, actor: Actor): void {
  if (actor.kind === "guest") throw new UnauthenticatedError();
  if (!isSuperAdmin(ctx, actor)) throw new ForbiddenError();
}

/** Whether `actor` has the yes/no permission `id` in `context`. */
export function can(
  ctx: Ctx,
  actor: Actor,
  id: FlagPermissionId,
  context: PermissionContext = {},
): boolean {
  return evaluate(ctx, actor, id, context).granted;
}

/**
 * Throws unless `actor` has the permission. Guests denied a permission that requires an account
 * get UnauthenticatedError; others get ForbiddenError, or NotFoundError with `notFound` (when
 * the denial must not reveal that the target exists). A permission held but for the +18 mark of
 * its node throws AdultContentError either way: the +18 page, not the content.
 */
export function requirePermission(
  ctx: Ctx,
  actor: Actor,
  id: FlagPermissionId,
  context: PermissionContext = {},
  options: { notFound?: boolean } = {},
): void {
  const result = evaluate(ctx, actor, id, context);
  if (result.granted) return;
  if (result.denial === "adult") throw new AdultContentError(result.adult!);
  if (options.notFound) throw new NotFoundError();
  if (result.denial === "account") throw new UnauthenticatedError();
  if (result.denial === "awaiting") throw approvalPending();
  throw new ForbiddenError();
}

/** The resolved value of an integer permission; -1 means unlimited. Banned members get 0. */
export function permissionValue(
  ctx: Ctx,
  actor: Actor,
  id: IntegerPermissionId,
  context: { nodeId?: number } = {},
): number {
  const def = PERMISSIONS[id];
  requireContext(id, def, context);
  const resolved = resolve(ctx, actor);
  if (isBanned(resolved.principal, ctx.now())) return 0;
  const nodeIndex =
    def.scope === "node" ? (resolved.state.nodeIndex.get(context.nodeId!) ?? -1) : -1;
  return integerAt(resolved.combination, id, nodeIndex);
}

/**
 * Resolves the actor once for several checks (a page of items): `can` and `value` behave like
 * the functions of the same name.
 */
export function permissionsOf(ctx: Ctx, actor: Actor, options: AdultOption = {}) {
  const resolved = resolve(ctx, actor);
  const adult = options.ignoreAdult ? () => null : adultCheck(ctx, actor);
  return {
    can: (id: FlagPermissionId, context: PermissionContext = {}) =>
      evaluate(ctx, actor, id, context, resolved, adult).granted,
    value: (id: IntegerPermissionId, context: { nodeId?: number } = {}) => {
      const def = PERMISSIONS[id];
      requireContext(id, def, context);
      if (isBanned(resolved.principal, ctx.now())) return 0;
      const nodeIndex =
        def.scope === "node" ? (resolved.state.nodeIndex.get(context.nodeId!) ?? -1) : -1;
      return integerAt(resolved.combination, id, nodeIndex);
    },
  };
}

/** Node ids `actor` may view, in tree order (+18 nodes only for a viewer who may see them). */
export function viewableNodeIds(ctx: Ctx, actor: Actor, options: AdultOption = {}): number[] {
  const resolved = resolve(ctx, actor);
  if (isBanned(resolved.principal, ctx.now())) return [];
  const adult = options.ignoreAdult ? () => null : adultCheck(ctx, actor);
  const ids: number[] = [];
  resolved.state.tree.entries.forEach((entry, i) => {
    if (!flagAt(resolved.combination, "node.view", i)) return;
    if (entry.adult && adult()) return;
    ids.push(entry.id);
  });
  return ids;
}

/**
 * Every permission of one scope resolved for `actor`, for responses that describe the current
 * actor: global permissions, or node permissions on `nodeId`. Content conditions (own content,
 * time limits, hierarchy, thread bans) are not applied: the value says whether the permission
 * itself is granted. Bans, restrictions and the guest rule are applied.
 */
export function resolvedPermissions(
  ctx: Ctx,
  actor: Actor,
  scope: { nodeId?: number } = {},
): Record<string, boolean | number> {
  const resolved = resolve(ctx, actor);
  // What a waiting account keeps is read by the groups it really holds.
  const real = resolved.principal?.awaitingApproval ? resolve(ctx, actor, true) : resolved;
  const now = ctx.now();
  const banned = isBanned(resolved.principal, now);
  const nodeIndex =
    scope.nodeId === undefined ? -1 : (resolved.state.nodeIndex.get(scope.nodeId) ?? -1);
  const result: Record<string, boolean | number> = {};
  for (const id of PERMISSION_IDS) {
    const def: PermissionDefinition = PERMISSIONS[id];
    if ((def.scope === "node") !== (scope.nodeId !== undefined)) continue;
    if (def.type === "integer") {
      result[id] = banned
        ? 0
        : integerAt(resolved.combination, id as IntegerPermissionId, nodeIndex);
      continue;
    }
    const keeps = AWAITING_KEEPS.has(id);
    result[id] =
      !banned &&
      !(
        def.requiresAccount &&
        (actor.kind === "guest" || (resolved.principal?.awaitingApproval && !keeps))
      ) &&
      !(
        def.restriction &&
        resolved.principal &&
        isRestricted(resolved.principal, def.restriction, now)
      ) &&
      flagAt((keeps ? real : resolved).combination, id as FlagPermissionId, nodeIndex);
  }
  return result;
}

/** Highest rank among the member's groups, and the group whose title and badge they display. */
export function memberStanding(
  ctx: Ctx,
  actor: Actor,
): { maxRank: number; displayGroupId: number | null } {
  const { combination } = resolve(ctx, actor);
  return { maxRank: combination.maxRank, displayGroupId: combination.displayGroupId };
}

/**
 * The cache versions a request already holds (its actor's principal), so building another
 * member's actor for a decision or a display costs no lookup. Falls back to reading them.
 */
export function requestVersions(ctx: Ctx, actor: Actor): PermissionVersions {
  if (actor.kind === "guest") return actor.versions ?? currentVersions(ctx);
  return actor.principal?.versions ?? currentVersions(ctx);
}

/** The group whose title and badge a member displays (their highest-ranked group). */
export function memberDisplay(
  ctx: Ctx,
  actor: Actor,
): { groupId: number; title: string; userTitle: string; badge: string } | null {
  const { combination, state } = resolve(ctx, actor);
  const group =
    combination.displayGroupId === null ? undefined : state.groups.get(combination.displayGroupId);
  return group
    ? { groupId: group.id, title: group.title, userTitle: group.userTitle, badge: group.badge }
    : null;
}

/** Combinations (resolved now, including inside a transaction) that grant a global flag. */
export function combinationsGranting(ctx: Ctx, id: FlagPermissionId): number[] {
  const state = permissionState(ctx);
  return allCombinations(ctx, state)
    .filter((combination) => flagAt(combination, id, -1))
    .map((combination) => combination.id);
}

// Explain ----------------------------------------------------------------------------------

export interface LayerExplanation {
  /** `purchase`: the permissions the member holds through shop items. */
  kind: "group" | "member" | "purchase";
  groupId: number | null;
  userId: number | null;
  title: string | null;
  /** The deciding entry's value for this layer. */
  value: "allow" | "no" | "never" | "unset" | number;
  /** Where that entry is set: a node id, 0 for the global scope, null when unset. */
  sourceNodeId: number | null;
}

export interface PermissionExplanation {
  permission: PermissionId;
  scope: "global" | "node";
  nodeId: number | null;
  granted: boolean;
  value: number | null;
  /** Rule that denied it, or null when granted or merely not granted by any layer. */
  deniedBy: Denial | "viewRequired" | null;
  layers: LayerExplanation[];
}

function deciding(
  layerEntries: readonly { permission: PermissionId; nodeId: number; value: number }[],
  id: PermissionId,
  chain: readonly number[],
): { value: number; nodeId: number } | null {
  for (const nodeId of chain) {
    const entry = layerEntries.find((e) => e.permission === id && e.nodeId === nodeId);
    if (entry) return { value: entry.value, nodeId };
  }
  return null;
}

/**
 * Shows, for `subject` and permission `id` in `context`, the result and which group or member
 * entry produced it: per layer, the nearest entry (node, then its ancestors, then global).
 */
export function explainPermission(
  ctx: Ctx,
  subject: Actor,
  id: PermissionId,
  context: PermissionContext = {},
): PermissionExplanation {
  const def: PermissionDefinition = PERMISSIONS[id];
  const nodeId = def.scope === "node" ? (context.nodeId ?? null) : null;
  let granted: boolean;
  let value: number | null = null;
  let deniedBy: PermissionExplanation["deniedBy"] = null;
  let resolved: Resolved;
  if (def.type === "flag") {
    const result = evaluate(ctx, subject, id as FlagPermissionId, context);
    granted = result.granted;
    resolved = result.resolved;
    if (!granted && result.denial !== "notGranted") deniedBy = result.denial ?? null;
  } else {
    value = permissionValue(ctx, subject, id as IntegerPermissionId, context);
    granted = value !== 0;
    resolved = resolve(ctx, subject);
    if (isBanned(resolved.principal, ctx.now())) deniedBy = "banned";
  }
  const chain: number[] = [];
  if (nodeId !== null) {
    chain.push(nodeId);
    for (const ancestor of [...resolved.state.tree.ancestors(nodeId)].reverse())
      chain.push(ancestor.id);
  }
  chain.push(0);
  const layers: LayerExplanation[] = resolved.combination.layerKeys.map((key) => {
    const layer = resolved.state.layers.get(key);
    const entry = layer ? deciding(layer.entries, id, chain) : null;
    const isMember = !key.startsWith("g:");
    const groupId = isMember ? null : Number(key.slice(2));
    const raw = entry?.value;
    return {
      kind: key.startsWith("p:") ? "purchase" : isMember ? "member" : "group",
      groupId,
      userId: isMember ? Number(key.slice(2)) : null,
      title: groupId === null ? null : (resolved.state.groups.get(groupId)?.title ?? null),
      value:
        raw === undefined
          ? "unset"
          : def.type === "integer"
            ? raw
            : raw === 1
              ? "allow"
              : raw === -1
                ? "never"
                : "no",
      sourceNodeId: entry ? entry.nodeId : null,
    };
  });
  if (
    def.type === "flag" &&
    !granted &&
    deniedBy === null &&
    nodeId !== null &&
    id !== "node.view" &&
    layers.some((l) => l.value === "allow") &&
    !layers.some((l) => l.value === "never")
  )
    deniedBy = "viewRequired";
  return { permission: id, scope: def.scope, nodeId, granted, value, deniedBy, layers };
}
