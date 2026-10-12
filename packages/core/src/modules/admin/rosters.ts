import type { Actor } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { staffAdministrators, staffModerators } from "../../contracts/admin";
import { implement } from "../../operation";
import {
  getNodeTree,
  memberActor,
  PRINCIPAL_COLUMNS,
  type PrincipalRow,
  permissionState,
  requestVersions,
  requirePermission,
  resolvedPermissions,
} from "../../permissions";
import { loadUserSummaries } from "../../shared/users";
import { ADMIN_PERMISSIONS, moderationOf, NODE_MODERATION } from "../auth/staff";
import { loadMemberCards } from "../members/cards";

/** The most members a roster lists, and the most it gathers from each source of membership. */
export const ROSTER_LIMIT = 200;

const SOURCES = [
  ["users", "id"],
  ["user_groups", "user_id"],
  ["user_group_grants", "user_id"],
  ["shop_group_grants", "user_id"],
] as const;
export const rosterSql = {
  members: (table: (typeof SOURCES)[number][0], column: string) =>
    `SELECT t.${column} AS user_id FROM json_each(?1) AS j CROSS JOIN ${table} AS t ON t.group_id = j.value LIMIT ${ROSTER_LIMIT + 1}`,
  rows: `SELECT u.id, u.group_id, ${PRINCIPAL_COLUMNS} FROM users u WHERE u.id IN (SELECT value FROM json_each(?1))`,
};

/**
 * Members who may hold one of `wanted`, from the permission entries alone: the members of every
 * group with an allowing entry for one of them (through the membership indexes, a bounded number
 * per source), and the members with an entry of their own or one bought in the shop. The
 * entries are in the permission state already in memory; a candidate is not yet a holder (a
 * `never` elsewhere, a ban), which the caller settles by resolving them.
 */
function candidates(ctx: Ctx, actor: Actor, wanted: ReadonlySet<string>): number[] {
  const state = permissionState(ctx, requestVersions(ctx, actor));
  const groupIds = new Set<number>();
  const members = new Set<number>();
  for (const layer of state.layers.values()) {
    if (!layer.entries.some((entry) => entry.value === 1 && wanted.has(entry.permission))) continue;
    if (layer.userId > 0) members.add(layer.userId);
    else groupIds.add(layer.groupId);
  }
  if (groupIds.size > 0) {
    const json = JSON.stringify([...groupIds]);
    for (const [table, column] of SOURCES)
      for (const row of prepared(ctx, `admin.roster.${table}`, () =>
        ctx.sqlite.prepare<{ user_id: number }, [string]>(rosterSql.members(table, column)),
      ).all(json))
        members.add(row.user_id);
  }
  return [...members];
}

type Row = PrincipalRow & { id: number; group_id: number };

/** The candidates as actors carrying their principal, in one query. */
function memberActors(ctx: Ctx, actor: Actor, ids: number[]) {
  if (ids.length === 0) return [];
  const versions = requestVersions(ctx, actor);
  return prepared(ctx, "admin.roster.rows", () => ctx.sqlite.prepare<Row, [string]>(rosterSql.rows))
    .all(JSON.stringify(ids))
    .map((row) => ({ id: row.id, actor: memberActor(row.id, row.group_id, row, versions) }));
}

/** The first `ROSTER_LIMIT` of `ids` by username. */
function byUsername(ctx: Ctx, ids: number[]): number[] {
  const name = loadUserSummaries(ctx, ids);
  return ids
    .map((id) => ({ id, key: name(id).username.toLowerCase() }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.id - b.id))
    .slice(0, ROSTER_LIMIT)
    .map((entry) => entry.id);
}

const MODERATION_IDS: ReadonlySet<string> = new Set(NODE_MODERATION);
const ADMIN_IDS: ReadonlySet<string> = new Set(ADMIN_PERMISSIONS);

export const staffModeratorsOp = implement(staffModerators, (ctx, actor) => {
  requirePermission(ctx, actor, "admin.permissions");
  const tree = getNodeTree(ctx);
  const holders = new Map<number, { everywhere: boolean; nodeIds: number[] }>();
  for (const member of memberActors(ctx, actor, candidates(ctx, actor, MODERATION_IDS))) {
    const moderated = moderationOf(ctx, member.actor as Exclude<Actor, { kind: "guest" }>);
    if (moderated.everywhere || moderated.nodeIds.length > 0) holders.set(member.id, moderated);
  }
  const page = byUsername(ctx, [...holders.keys()]);
  const cards = loadMemberCards(ctx, actor, page);
  return {
    items: page.flatMap((id) => {
      const card = cards.get(id);
      const moderated = holders.get(id)!;
      return card
        ? [
            {
              card,
              everywhere: moderated.everywhere,
              nodes: moderated.everywhere
                ? []
                : moderated.nodeIds.map((nodeId) => ({
                    id: nodeId,
                    title: tree.get(nodeId)?.title ?? "",
                  })),
            },
          ]
        : [];
    }),
  };
});

export const staffAdministratorsOp = implement(staffAdministrators, (ctx, actor) => {
  requirePermission(ctx, actor, "admin.permissions");
  const holders = new Map<number, string[]>();
  for (const member of memberActors(ctx, actor, candidates(ctx, actor, ADMIN_IDS))) {
    const held = resolvedPermissions(ctx, member.actor);
    const ids = ADMIN_PERMISSIONS.filter((id) => held[id] === true);
    if (ids.length > 0) holders.set(member.id, ids);
  }
  const page = byUsername(ctx, [...holders.keys()]);
  const cards = loadMemberCards(ctx, actor, page);
  return {
    items: page.flatMap((id) => {
      const card = cards.get(id);
      return card ? [{ card, permissions: holders.get(id)! }] : [];
    }),
  };
});
