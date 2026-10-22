/**
 * The nodes under a deleted node move up a level without showing anything to anyone who could not
 * see it. Viewing is decided per layer (a group's or a member's entries, the nearest one up the
 * tree winning), the layers of a member combine (any never denies, otherwise any allow grants),
 * and a node is seen only if its parent is. Moved up, a node loses the deleted node from its chain,
 * so its own view must take over the deleted node's restriction:
 *
 * 1. it takes a copy of each entry of the deleted node it has none of its own for, so every layer
 *    resolves every permission on it and below it as before;
 * 2. an own view entry more open than what its layer gave the deleted node is lowered to that
 *    (never, then no, then allow), the nodes under it keeping the old value as their own entry;
 *    a node is then seen only by those who saw the deleted node and it, never by more;
 * 3. a member who saw it through two layers that no longer meet in one (one opening the deleted
 *    node, the other the moved one) gets an allow of their own on it, so a member with entries
 *    keeps what they saw. Members without entries of their own in that rare case lose it.
 *
 * The permission engine decides before and after, for every group alone and every combination a
 * member holds (each member with entries of their own holds one of their own): anything newly
 * seen stops the deletion.
 */
import type { SQLQueryBindings } from "bun:sqlite";
import { type Ctx, invalidate, prepared } from "../../context";
import {
  type CombinationDef,
  computeCombination,
  flagAt,
  LAYOUT,
  layerKey,
  type PermissionState,
  permissionState,
  VIEW_SLOT,
} from "../../permissions/state";

const VIEW_ID = "(SELECT id FROM permission_definitions WHERE key = 'node.view')";
const sql = {
  staying:
    "SELECT id FROM nodes WHERE parent_id = ?1 AND id NOT IN (SELECT value FROM json_each(?2)) ORDER BY id",
  copy: "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) SELECT permission_id, ?2, group_id, user_id, value FROM permission_entries WHERE node_id = ?1 ON CONFLICT (group_id, user_id, node_id, permission_id) DO NOTHING",
  views: `SELECT group_id, user_id, value FROM permission_entries WHERE node_id = ?1 AND permission_id = ${VIEW_ID}`,
  /** The nodes right under `?1` keep `?4` as their own view entry of the layer, unless they hold one. */
  pin: `INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) SELECT ${VIEW_ID}, id, ?2, ?3, ?4 FROM nodes WHERE parent_id = ?1 ON CONFLICT (group_id, user_id, node_id, permission_id) DO NOTHING`,
  held: "SELECT user_id, group_ids FROM permission_combinations WHERE id IN (SELECT permission_combination_id FROM users)",
  set: `INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES (${VIEW_ID}, ?1, ?2, ?3, ?4) ON CONFLICT (group_id, user_id, node_id, permission_id) DO UPDATE SET value = excluded.value`,
};

function statement<Row, Params extends SQLQueryBindings[]>(ctx: Ctx, text: string) {
  return prepared(ctx, `forums.moveUpView.${text}`, () => ctx.sqlite.prepare<Row, Params>(text));
}

/** What one layer says about viewing a node: 1 allow, -1 never, 0 nothing (or no). */
function layerView(state: PermissionState, groupId: number, userId: number, nodeId: number) {
  const layer = state.layers.get(layerKey(groupId, userId));
  const index = state.nodeIndex.get(nodeId);
  if (!layer || index === undefined) return 0;
  const word = index * LAYOUT.nodeWords + (VIEW_SLOT >>> 5);
  const mask = 1 << (VIEW_SLOT & 31);
  if (layer.nodeAllow[word]! & mask) return 1;
  return layer.nodeNever[word]! & mask ? -1 : 0;
}

/** Sets a layer's view entry on a node; the nodes right under it keep `inherited` as their own. */
function setView(
  ctx: Ctx,
  nodeId: number,
  layer: { groupId: number; userId: number },
  value: number,
  inherited: number,
) {
  statement(ctx, sql.pin).run(nodeId, layer.groupId, layer.userId, inherited);
  statement(ctx, sql.set).run(nodeId, layer.groupId, layer.userId, value);
}

/**
 * Every group alone (a guest is the guest group alone), and every combination a member holds now:
 * a stored combination no member holds any more (an old set of groups) decides nothing.
 */
function subjects(ctx: Ctx, state: PermissionState): CombinationDef[] {
  const defs: CombinationDef[] = [...state.groups.keys()].map((id) => ({
    userId: 0,
    groupIds: [id],
  }));
  for (const row of statement<{ user_id: number; group_ids: string }, []>(ctx, sql.held).all())
    defs.push({
      userId: row.user_id,
      groupIds: row.group_ids === "" ? [] : row.group_ids.split(",").map(Number),
    });
  return defs;
}

function seen(state: PermissionState, def: CombinationDef, nodes: readonly number[]): boolean[] {
  const combination = computeCombination(state, -1, def);
  return nodes.map((id) => flagAt(combination, "node.view", state.nodeIndex.get(id) ?? -1));
}

/** The state as this transaction has it now (a private copy, never stored). */
function stateNow(ctx: Ctx): PermissionState {
  invalidate(ctx, "node_tree");
  invalidate(ctx, "permissions");
  return permissionState(ctx);
}

/**
 * Re-parents (through `reparent`) the nodes right under `nodeId` that are not in `scope` (a JSON
 * array of the nodes going), keeping who sees them and everything below them. Inside the write
 * transaction, before the deleted node's entries go.
 */
export function moveUpKeepingView(
  ctx: Ctx,
  nodeId: number,
  scope: string,
  reparent: () => void,
): void {
  const staying = statement<{ id: number }, [number, string]>(ctx, sql.staying)
    .all(nodeId, scope)
    .map((row) => row.id);
  if (staying.length === 0) {
    reparent();
    return;
  }
  const before = permissionState(ctx);
  const watched = staying.flatMap((id) => before.tree.subtreeIds(id));
  const defs = subjects(ctx, before);
  const was = defs.map((def) => seen(before, def, watched));
  for (const child of staying) {
    statement(ctx, sql.copy).run(nodeId, child);
    for (const entry of statement<{ group_id: number; user_id: number; value: number }, [number]>(
      ctx,
      sql.views,
    ).all(child)) {
      const layer = { groupId: entry.group_id, userId: entry.user_id };
      const limit = layerView(before, layer.groupId, layer.userId, nodeId);
      if (entry.value > limit) setView(ctx, child, layer, limit, entry.value);
    }
  }
  reparent();
  const moved = stateNow(ctx);
  // A combination with a member in it is that member's own: an entry of theirs keeps them on it.
  defs.forEach((def, i) => {
    if (!def.userId) return;
    const now = seen(moved, def, watched);
    for (const child of staying) {
      const k = watched.indexOf(child);
      if (was[i]![k] && !now[k]) {
        const own = layerView(before, 0, def.userId, child);
        setView(ctx, child, { groupId: 0, userId: def.userId }, 1, own);
      }
    }
  });
  // Judged again on the combinations held after these writes, whatever they moved members to.
  const after = stateNow(ctx);
  for (const def of subjects(ctx, after)) {
    const then = seen(before, def, watched);
    const now = seen(after, def, watched);
    const shown = watched.find((_id, k) => now[k] && !then[k]);
    if (shown !== undefined)
      throw new Error(`Moving node ${shown} up would show it to members who could not see it.`);
  }
}
