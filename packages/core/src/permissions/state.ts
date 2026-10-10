/**
 * In-memory permission state. Entries are loaded per layer (one group's entries, or one member's
 * entries); a layer resolves node inheritance once; a combination (a member's set of layers) is
 * resolved from its layers on first use and precomputed in the background in small batches.
 *
 * Freshness: the state records the `permissions` and `node_tree` cache versions it reflects.
 * When a request's versions are newer, the state reloads only the layers whose version in
 * `permission_layer_versions` changed. The state is never stored from inside a transaction.
 */
import type { PermissionVersions } from "../actor";
import type { Ctx } from "../context";
import {
  type FlagPermissionId,
  type IntegerPermissionId,
  PERMISSION_IDS,
  PERMISSIONS,
  type PermissionDefinition,
  type PermissionId,
} from "./registry";
import { getNodeTree, type NodeTree } from "./tree";

// Layout -----------------------------------------------------------------------------------

interface Slot {
  readonly scope: "global" | "node";
  readonly type: "flag" | "integer";
  /** Bit index for flags, array index for integers, within its scope. */
  readonly index: number;
}

function buildLayout() {
  const slots = new Map<PermissionId, Slot>();
  const counts = { globalFlag: 0, nodeFlag: 0, globalInt: 0, nodeInt: 0 };
  for (const id of PERMISSION_IDS) {
    const def: PermissionDefinition = PERMISSIONS[id];
    const key = `${def.scope}${def.type === "flag" ? "Flag" : "Int"}` as keyof typeof counts;
    slots.set(id, { scope: def.scope, type: def.type, index: counts[key]++ });
  }
  return {
    slots,
    globalWords: Math.ceil(counts.globalFlag / 32),
    nodeWords: Math.ceil(counts.nodeFlag / 32),
    globalInts: counts.globalInt,
    nodeInts: counts.nodeInt,
  };
}
export const LAYOUT = buildLayout();
export const VIEW_SLOT = LAYOUT.slots.get("node.view")!.index;

export function slotOf(id: PermissionId): Slot {
  return LAYOUT.slots.get(id)!;
}

// Types ------------------------------------------------------------------------------------

export interface EntryRow {
  readonly permission: PermissionId;
  readonly nodeId: number;
  readonly value: number;
}

export interface GroupInfo {
  readonly id: number;
  readonly title: string;
  readonly rank: number;
  readonly userTitle: string;
  readonly badge: string;
  readonly builtin: string | null;
}

/** A group's or a member's entries with node inheritance applied. */
export interface Layer {
  readonly key: string;
  readonly groupId: number;
  readonly userId: number;
  readonly entries: readonly EntryRow[];
  readonly globalAllow: Uint32Array;
  readonly globalNever: Uint32Array;
  /** NaN = unset. */
  readonly globalInt: Float64Array;
  /** Per node index, `nodeWords` words each. */
  readonly nodeAllow: Uint32Array;
  readonly nodeNever: Uint32Array;
  readonly nodeInt: Float64Array;
}

export interface Combination {
  readonly id: number;
  readonly userId: number;
  readonly groupIds: readonly number[];
  readonly layerKeys: readonly string[];
  /** Highest rank among the member's groups (hierarchy). */
  readonly maxRank: number;
  /** The highest-ranked group, whose title and badge the member displays. */
  readonly displayGroupId: number | null;
  readonly globalFlags: Uint32Array;
  /** Resolved integers; unset resolves to 0. */
  readonly globalInt: Float64Array;
  readonly nodeFlags: Uint32Array;
  readonly nodeInt: Float64Array;
}

export interface CombinationDef {
  readonly userId: number;
  readonly groupIds: readonly number[];
}

export interface PermissionState {
  versions: PermissionVersions;
  tree: NodeTree;
  nodeIndex: Map<number, number>;
  /** Parent node index per node index, -1 for roots. */
  parentIndex: Int32Array;
  definitionKeys: Map<number, PermissionId>;
  groups: Map<number, GroupInfo>;
  layerVersions: Map<string, number>;
  layers: Map<string, Layer>;
  combinationDefs: Map<number, CombinationDef>;
  combinationByKey: Map<string, number>;
  maxCombinationId: number;
  combinations: Map<number, Combination>;
}

export const layerKey = (groupId: number, userId: number) =>
  userId ? `u:${userId}` : `g:${groupId}`;
export const combinationKey = (userId: number, groupIds: readonly number[]) =>
  `${userId}|${groupIds.join(",")}`;

// Loading ----------------------------------------------------------------------------------

const STATE_KEY = "permission_state";

function readVersions(ctx: Ctx): PermissionVersions {
  const rows = ctx.sqlite
    .prepare<{ key: string; version: number }, []>(
      "SELECT key, version FROM cache_versions WHERE key IN ('permissions', 'node_tree')",
    )
    .all();
  let permissions = 0;
  let nodeTree = 0;
  for (const row of rows) {
    if (row.key === "permissions") permissions = row.version;
    else nodeTree = row.version;
  }
  return { permissions, nodeTree };
}

/** Both cache versions in one lookup, for actors that carry none. */
export function currentVersions(ctx: Ctx): PermissionVersions {
  return readVersions(ctx);
}

function loadDefinitionKeys(ctx: Ctx): Map<number, PermissionId> {
  const map = new Map<number, PermissionId>();
  for (const row of ctx.sqlite
    .prepare<{ id: number; key: string }, []>("SELECT id, key FROM permission_definitions")
    .all())
    if (Object.hasOwn(PERMISSIONS, row.key)) map.set(row.id, row.key as PermissionId);
  return map;
}

function loadGroups(ctx: Ctx): Map<number, GroupInfo> {
  const map = new Map<number, GroupInfo>();
  for (const row of ctx.sqlite
    .prepare<
      {
        id: number;
        title: string;
        rank: number;
        user_title: string;
        badge: string;
        builtin: string | null;
      },
      []
    >("SELECT id, title, rank, user_title, badge, builtin FROM groups")
    .all())
    map.set(row.id, {
      id: row.id,
      title: row.title,
      rank: row.rank,
      userTitle: row.user_title,
      badge: row.badge,
      builtin: row.builtin,
    });
  return map;
}

function loadLayerVersions(ctx: Ctx): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of ctx.sqlite
    .prepare<{ group_id: number; user_id: number; version: number }, []>(
      "SELECT group_id, user_id, version FROM permission_layer_versions",
    )
    .all())
    map.set(layerKey(row.group_id, row.user_id), row.version);
  return map;
}

type RawEntry = {
  permission_id: number;
  node_id: number;
  group_id: number;
  user_id: number;
  value: number;
};

function toEntries(rows: RawEntry[], keys: Map<number, PermissionId>): EntryRow[] {
  const entries: EntryRow[] = [];
  for (const row of rows) {
    const permission = keys.get(row.permission_id);
    if (permission) entries.push({ permission, nodeId: row.node_id, value: row.value });
  }
  return entries;
}

function loadAllEntries(ctx: Ctx, keys: Map<number, PermissionId>): Map<string, EntryRow[]> {
  const byLayer = new Map<string, RawEntry[]>();
  for (const row of ctx.sqlite
    .prepare<RawEntry, []>(
      "SELECT permission_id, node_id, group_id, user_id, value FROM permission_entries",
    )
    .all()) {
    const key = layerKey(row.group_id, row.user_id);
    const list = byLayer.get(key);
    if (list) list.push(row);
    else byLayer.set(key, [row]);
  }
  const result = new Map<string, EntryRow[]>();
  for (const [key, rows] of byLayer) result.set(key, toEntries(rows, keys));
  return result;
}

function loadLayerEntries(ctx: Ctx, key: string, keys: Map<number, PermissionId>): EntryRow[] {
  const [kind, raw] = key.split(":") as ["g" | "u", string];
  const id = Number(raw);
  return toEntries(
    ctx.sqlite
      .prepare<RawEntry, [number, number]>(
        "SELECT permission_id, node_id, group_id, user_id, value FROM permission_entries WHERE group_id = ?1 AND user_id = ?2",
      )
      .all(kind === "g" ? id : 0, kind === "u" ? id : 0),
    keys,
  );
}

function loadCombinationDefs(
  ctx: Ctx,
  afterId: number,
  into: Pick<PermissionState, "combinationDefs" | "combinationByKey" | "maxCombinationId">,
): void {
  for (const row of ctx.sqlite
    .prepare<{ id: number; user_id: number; group_ids: string }, [number]>(
      "SELECT id, user_id, group_ids FROM permission_combinations WHERE id > ?1 ORDER BY id",
    )
    .all(afterId)) {
    const groupIds = row.group_ids === "" ? [] : row.group_ids.split(",").map(Number);
    into.combinationDefs.set(row.id, { userId: row.user_id, groupIds });
    into.combinationByKey.set(combinationKey(row.user_id, groupIds), row.id);
    if (row.id > into.maxCombinationId) into.maxCombinationId = row.id;
  }
}

// Layers and combinations ------------------------------------------------------------------

function treeIndex(tree: NodeTree) {
  const nodeIndex = new Map<number, number>();
  tree.entries.forEach((entry, i) => {
    nodeIndex.set(entry.id, i);
  });
  const parentIndex = new Int32Array(tree.entries.length);
  tree.entries.forEach((entry, i) => {
    parentIndex[i] = entry.parentId == null ? -1 : (nodeIndex.get(entry.parentId) ?? -1);
  });
  return { nodeIndex, parentIndex };
}

function applyFlag(
  allow: Uint32Array,
  never: Uint32Array,
  offset: number,
  bit: number,
  value: number,
) {
  const word = offset + (bit >>> 5);
  const mask = 1 << (bit & 31);
  allow[word]! &= ~mask;
  never[word]! &= ~mask;
  if (value === 1) allow[word]! |= mask;
  else if (value === -1) never[word]! |= mask;
}

export function buildLayer(
  key: string,
  entries: readonly EntryRow[],
  tree: NodeTree,
  nodeIndex: Map<number, number>,
  parentIndex: Int32Array,
): Layer {
  const { globalWords, nodeWords, globalInts, nodeInts } = LAYOUT;
  const n = tree.entries.length;
  const globalAllow = new Uint32Array(globalWords);
  const globalNever = new Uint32Array(globalWords);
  const globalInt = new Float64Array(globalInts).fill(Number.NaN);
  const rootAllow = new Uint32Array(nodeWords);
  const rootNever = new Uint32Array(nodeWords);
  const rootInt = new Float64Array(nodeInts).fill(Number.NaN);
  const atNode = new Map<number, EntryRow[]>();
  for (const entry of entries) {
    const slot = slotOf(entry.permission);
    if (entry.nodeId === 0) {
      if (slot.scope === "global") {
        if (slot.type === "flag") applyFlag(globalAllow, globalNever, 0, slot.index, entry.value);
        else globalInt[slot.index] = entry.value;
      } else if (slot.type === "flag") applyFlag(rootAllow, rootNever, 0, slot.index, entry.value);
      else rootInt[slot.index] = entry.value;
    } else if (slot.scope === "node" && nodeIndex.has(entry.nodeId)) {
      const list = atNode.get(entry.nodeId);
      if (list) list.push(entry);
      else atNode.set(entry.nodeId, [entry]);
    }
  }
  const nodeAllow = new Uint32Array(n * nodeWords);
  const nodeNever = new Uint32Array(n * nodeWords);
  const nodeInt = new Float64Array(n * nodeInts);
  // Entries are depth-first, so a parent is always resolved before its children.
  for (let i = 0; i < n; i++) {
    const parent = parentIndex[i]!;
    if (parent < 0) {
      nodeAllow.set(rootAllow, i * nodeWords);
      nodeNever.set(rootNever, i * nodeWords);
      nodeInt.set(rootInt, i * nodeInts);
    } else {
      nodeAllow.copyWithin(i * nodeWords, parent * nodeWords, (parent + 1) * nodeWords);
      nodeNever.copyWithin(i * nodeWords, parent * nodeWords, (parent + 1) * nodeWords);
      nodeInt.copyWithin(i * nodeInts, parent * nodeInts, (parent + 1) * nodeInts);
    }
    for (const entry of atNode.get(tree.entries[i]!.id) ?? []) {
      const slot = slotOf(entry.permission);
      if (slot.type === "flag")
        applyFlag(nodeAllow, nodeNever, i * nodeWords, slot.index, entry.value);
      else nodeInt[i * nodeInts + slot.index] = entry.value;
    }
  }
  const [kind, raw] = key.split(":") as ["g" | "u", string];
  return {
    key,
    groupId: kind === "g" ? Number(raw) : 0,
    userId: kind === "u" ? Number(raw) : 0,
    entries,
    globalAllow,
    globalNever,
    globalInt,
    nodeAllow,
    nodeNever,
    nodeInt,
  };
}

/** -1 (unlimited) beats every other value; otherwise the highest wins. */
export function higherLimit(a: number, b: number): number {
  if (Number.isNaN(a)) return b;
  if (Number.isNaN(b)) return a;
  if (a === -1 || b === -1) return -1;
  return a > b ? a : b;
}

const EMPTY_LAYER_ENTRIES: readonly EntryRow[] = [];

function layerFor(state: PermissionState, key: string): Layer {
  let layer = state.layers.get(key);
  if (!layer) {
    layer = buildLayer(key, EMPTY_LAYER_ENTRIES, state.tree, state.nodeIndex, state.parentIndex);
    state.layers.set(key, layer);
  }
  return layer;
}

export function computeCombination(
  state: PermissionState,
  id: number,
  def: CombinationDef,
): Combination {
  const { globalWords, nodeWords, globalInts, nodeInts } = LAYOUT;
  const n = state.tree.entries.length;
  const layerKeys = def.groupIds.filter((g) => state.groups.has(g)).map((g) => layerKey(g, 0));
  if (def.userId) layerKeys.push(layerKey(0, def.userId));
  const layers = layerKeys.map((key) => layerFor(state, key));

  const globalAllow = new Uint32Array(globalWords);
  const globalNever = new Uint32Array(globalWords);
  const globalInt = new Float64Array(globalInts).fill(Number.NaN);
  const nodeAllow = new Uint32Array(n * nodeWords);
  const nodeNever = new Uint32Array(n * nodeWords);
  const nodeInt = new Float64Array(n * nodeInts).fill(Number.NaN);
  for (const layer of layers) {
    for (let w = 0; w < globalWords; w++) {
      globalAllow[w]! |= layer.globalAllow[w]!;
      globalNever[w]! |= layer.globalNever[w]!;
    }
    for (let k = 0; k < globalInts; k++)
      globalInt[k] = higherLimit(globalInt[k]!, layer.globalInt[k]!);
    for (let w = 0; w < n * nodeWords; w++) {
      nodeAllow[w]! |= layer.nodeAllow[w]!;
      nodeNever[w]! |= layer.nodeNever[w]!;
    }
    for (let k = 0; k < n * nodeInts; k++) nodeInt[k] = higherLimit(nodeInt[k]!, layer.nodeInt[k]!);
  }
  // Any never denies; otherwise any allow grants.
  const globalFlags = new Uint32Array(globalWords);
  for (let w = 0; w < globalWords; w++) globalFlags[w] = globalAllow[w]! & ~globalNever[w]!;
  const nodeFlags = new Uint32Array(n * nodeWords);
  const viewWord = VIEW_SLOT >>> 5;
  const viewMask = 1 << (VIEW_SLOT & 31);
  for (let i = 0; i < n; i++) {
    const base = i * nodeWords;
    for (let w = 0; w < nodeWords; w++)
      nodeFlags[base + w] = nodeAllow[base + w]! & ~nodeNever[base + w]!;
    // A node is viewable only if its parent is, and nothing in a node is permitted without view.
    const parent = state.parentIndex[i]!;
    const parentView = parent < 0 || (nodeFlags[parent * nodeWords + viewWord]! & viewMask) !== 0;
    if (!parentView || (nodeFlags[base + viewWord]! & viewMask) === 0)
      nodeFlags.fill(0, base, base + nodeWords);
  }
  for (let k = 0; k < globalInts; k++) if (Number.isNaN(globalInt[k]!)) globalInt[k] = 0;
  for (let k = 0; k < n * nodeInts; k++) if (Number.isNaN(nodeInt[k]!)) nodeInt[k] = 0;

  let maxRank = 0;
  let displayGroupId: number | null = null;
  for (const groupId of def.groupIds) {
    const group = state.groups.get(groupId);
    if (!group) continue;
    if (displayGroupId === null || group.rank > maxRank) {
      maxRank = group.rank;
      displayGroupId = group.id;
    }
  }
  return {
    id,
    userId: def.userId,
    groupIds: def.groupIds,
    layerKeys,
    maxRank,
    displayGroupId,
    globalFlags,
    globalInt,
    nodeFlags,
    nodeInt,
  };
}

// State management -------------------------------------------------------------------------

function fullBuild(ctx: Ctx, versions: PermissionVersions): PermissionState {
  const tree = getNodeTree(ctx);
  const { nodeIndex, parentIndex } = treeIndex(tree);
  const definitionKeys = loadDefinitionKeys(ctx);
  const state: PermissionState = {
    versions,
    tree,
    nodeIndex,
    parentIndex,
    definitionKeys,
    groups: loadGroups(ctx),
    layerVersions: loadLayerVersions(ctx),
    layers: new Map(),
    combinationDefs: new Map(),
    combinationByKey: new Map(),
    maxCombinationId: 0,
    combinations: new Map(),
  };
  for (const [key, entries] of loadAllEntries(ctx, definitionKeys))
    state.layers.set(key, buildLayer(key, entries, tree, nodeIndex, parentIndex));
  loadCombinationDefs(ctx, 0, state);
  return state;
}

/** Applies committed changes since `state.versions` to `state` (mutating it). */
function refresh(ctx: Ctx, state: PermissionState, versions: PermissionVersions): void {
  let resetCombinations = false;
  if (versions.nodeTree !== state.versions.nodeTree) {
    const tree = getNodeTree(ctx);
    if (tree !== state.tree) {
      const { nodeIndex, parentIndex } = treeIndex(tree);
      state.tree = tree;
      state.nodeIndex = nodeIndex;
      state.parentIndex = parentIndex;
      for (const [key, layer] of state.layers)
        state.layers.set(key, buildLayer(key, layer.entries, tree, nodeIndex, parentIndex));
      resetCombinations = true;
    }
  }
  if (versions.permissions !== state.versions.permissions) {
    const definitionKeys = loadDefinitionKeys(ctx);
    const definitionsChanged = definitionKeys.size !== state.definitionKeys.size;
    state.definitionKeys = definitionKeys;
    const groups = loadGroups(ctx);
    if (!sameGroups(groups, state.groups)) resetCombinations = true;
    state.groups = groups;
    const layerVersions = loadLayerVersions(ctx);
    const changed = new Set<string>();
    for (const [key, version] of layerVersions)
      if (definitionsChanged || state.layerVersions.get(key) !== version) changed.add(key);
    for (const key of state.layers.keys())
      if (!layerVersions.has(key) && state.layerVersions.has(key)) changed.add(key);
    state.layerVersions = layerVersions;
    for (const key of changed)
      state.layers.set(
        key,
        buildLayer(
          key,
          loadLayerEntries(ctx, key, definitionKeys),
          state.tree,
          state.nodeIndex,
          state.parentIndex,
        ),
      );
    if (!resetCombinations && changed.size > 0)
      for (const [id, combination] of state.combinations)
        if (combination.layerKeys.some((key) => changed.has(key))) state.combinations.delete(id);
    loadCombinationDefs(ctx, state.maxCombinationId, state);
  }
  if (resetCombinations) state.combinations.clear();
  state.versions = versions;
}

function sameGroups(a: Map<number, GroupInfo>, b: Map<number, GroupInfo>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, group] of a) {
    const other = b.get(id);
    if (!other || other.rank !== group.rank || other.title !== group.title) return false;
    if (other.userTitle !== group.userTitle || other.badge !== group.badge) return false;
  }
  return true;
}

function cloneState(state: PermissionState): PermissionState {
  return {
    ...state,
    layerVersions: new Map(state.layerVersions),
    layers: new Map(state.layers),
    combinationDefs: new Map(state.combinationDefs),
    combinationByKey: new Map(state.combinationByKey),
    combinations: new Map(state.combinations),
  };
}

const precomputing = new WeakSet<PermissionState>();

/**
 * Returns state at least as fresh as `versions` (the request's view), refreshing it when it is
 * older. Without `versions` the current versions are read (one lookup).
 */
export function permissionState(ctx: Ctx, versions?: PermissionVersions): PermissionState {
  const entry = ctx.caches.get(STATE_KEY) as
    | { version: number; value: PermissionState }
    | undefined;
  const stored = entry?.value;
  const wanted = versions ?? readVersions(ctx);
  if (
    stored &&
    stored.versions.permissions >= wanted.permissions &&
    stored.versions.nodeTree >= wanted.nodeTree
  )
    return stored;
  // The stored state lags the request: read the committed versions now and catch up.
  const current = ctx.sqlite.inTransaction || versions ? readVersions(ctx) : wanted;
  if (ctx.sqlite.inTransaction) {
    // Inside a transaction the data may be uncommitted: build a private copy, never store it.
    if (!stored) return fullBuild(ctx, current);
    const copy = cloneState(stored);
    refresh(ctx, copy, current);
    return copy;
  }
  let state: PermissionState;
  if (stored) {
    state = stored;
    refresh(ctx, state, current);
  } else {
    state = fullBuild(ctx, current);
    ctx.caches.set(STATE_KEY, { version: 0, value: state });
  }
  schedulePrecompute(ctx, state);
  return state;
}

/** The combination for an id, computing (and caching) it on first use. */
export function combinationById(state: PermissionState, id: number): Combination | undefined {
  let combination = state.combinations.get(id);
  if (!combination) {
    const def = state.combinationDefs.get(id);
    if (!def) return undefined;
    combination = computeCombination(state, id, def);
    state.combinations.set(id, combination);
  }
  return combination;
}

/**
 * Loads a combination created after the state was built (a membership change creates one without
 * a permission version change). It is kept in the state only outside a transaction: an
 * uncommitted row can be rolled back and its id reused for another set of groups.
 */
export function loadCombinationDef(
  ctx: Ctx,
  state: PermissionState,
  id: number,
): CombinationDef | null {
  const row = ctx.sqlite
    .prepare<{ user_id: number; group_ids: string }, [number]>(
      "SELECT user_id, group_ids FROM permission_combinations WHERE id = ?1",
    )
    .get(id);
  if (!row) return null;
  const def = {
    userId: row.user_id,
    groupIds: row.group_ids === "" ? [] : row.group_ids.split(",").map(Number),
  };
  if (!ctx.sqlite.inTransaction) {
    state.combinationDefs.set(id, def);
    state.combinationByKey.set(combinationKey(def.userId, def.groupIds), id);
    if (id > state.maxCombinationId) state.maxCombinationId = id;
  }
  return def;
}

/** Every combination, including ones created after the state was built (same rule). */
export function allCombinations(ctx: Ctx, state: PermissionState): Combination[] {
  const result: Combination[] = [];
  for (const id of state.combinationDefs.keys()) result.push(combinationById(state, id)!);
  const newer = ctx.sqlite
    .prepare<{ id: number; user_id: number; group_ids: string }, [number]>(
      "SELECT id, user_id, group_ids FROM permission_combinations WHERE id > ?1 ORDER BY id",
    )
    .all(state.maxCombinationId);
  for (const row of newer) {
    const def = {
      userId: row.user_id,
      groupIds: row.group_ids === "" ? [] : row.group_ids.split(",").map(Number),
    };
    if (ctx.sqlite.inTransaction) result.push(computeCombination(state, row.id, def));
    else {
      loadCombinationDef(ctx, state, row.id);
      result.push(combinationById(state, row.id)!);
    }
  }
  return result;
}

/**
 * Resolves every known combination in batches of 100, yielding to the event loop between
 * batches, so a change never makes one request pay for resolving thousands of combinations.
 * Stops when the state is superseded.
 */
function schedulePrecompute(ctx: Ctx, state: PermissionState): void {
  if (precomputing.has(state)) return;
  precomputing.add(state);
  const ids = () => [...state.combinationDefs.keys()].filter((id) => !state.combinations.has(id));
  const step = () => {
    const current = (ctx.caches.get(STATE_KEY) as { value: PermissionState } | undefined)?.value;
    if (current !== state) {
      precomputing.delete(state);
      return;
    }
    const pending = ids();
    for (const id of pending.slice(0, 100)) combinationById(state, id);
    if (pending.length > 100) setTimeout(step, 0).unref?.();
    else precomputing.delete(state);
  };
  setTimeout(step, 0).unref?.();
}

/** Resolves every combination now (used by benchmarks and by checks that need them all). */
export function resolveAllCombinations(state: PermissionState): Combination[] {
  const result: Combination[] = [];
  for (const id of state.combinationDefs.keys()) result.push(combinationById(state, id)!);
  return result;
}

// Bit access -------------------------------------------------------------------------------

export function flagAt(combination: Combination, id: FlagPermissionId, nodeIndex: number): boolean {
  const slot = slotOf(id);
  if (slot.scope === "global")
    return (combination.globalFlags[slot.index >>> 5]! & (1 << (slot.index & 31))) !== 0;
  if (nodeIndex < 0) return false;
  const word = nodeIndex * LAYOUT.nodeWords + (slot.index >>> 5);
  return (combination.nodeFlags[word]! & (1 << (slot.index & 31))) !== 0;
}

export function integerAt(
  combination: Combination,
  id: IntegerPermissionId,
  nodeIndex: number,
): number {
  const slot = slotOf(id);
  if (slot.scope === "global") return combination.globalInt[slot.index]!;
  if (nodeIndex < 0) return 0;
  return combination.nodeInt[nodeIndex * LAYOUT.nodeInts + slot.index]!;
}
