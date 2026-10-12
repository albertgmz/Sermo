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

/** The most members a roster lists, and the most it gathers from each group in each source. */
export const ROSTER_LIMIT = 200;

const SOURCES = [
  ["users", "id"],
  ["user_groups", "user_id"],
  ["user_group_grants", "user_id"],
  ["shop_group_grants", "user_id"],
] as const;
export const rosterSql = {
  members: (table: (typeof SOURCES)[number][0], column: string) =>
    `SELECT ${column} AS user_id FROM ${table} WHERE group_id = ?1 LIMIT ${ROSTER_LIMIT + 1}`,
  rows: `SELECT u.id, u.group_id, ${PRINCIPAL_COLUMNS} FROM users u WHERE u.id IN (SELECT value FROM json_each(?1))`,
};

/**
 * Members who may hold one of `wanted`, from the permission entries alone: the members of every
 * group with an allowing entry for one of them (through the membership indexes, a bounded number
 * per source), and the members with an entry of their own or one bought in the shop. The
 * entries are in the permission state already in memory; a candidate is not yet a holder (a
 * `never` elsewhere, a ban), which the caller settles by resolving them. Each group is read
 * on its own bound, so a large group cannot crowd out the others; `truncated` says some group
 * had more members than were read.
 */
function candidates(
  ctx: Ctx,
  actor: Actor,
  wanted: ReadonlySet<string>,
): { ids: number[]; truncated: boolean } {
  const state = permissionState(ctx, requestVersions(ctx, actor));
  const groupIds = new Set<number>();
  const members = new Set<number>();
  for (const layer of state.layers.values()) {
    if (!layer.entries.some((entry) => entry.value === 1 && wanted.has(entry.permission))) continue;
    if (layer.userId > 0) members.add(layer.userId);
    else groupIds.add(layer.groupId);
  }
  let truncated = false;
  for (const groupId of groupIds)
    for (const [table, column] of SOURCES) {
      const rows = prepared(ctx, `admin.roster.${table}`, () =>
        ctx.sqlite.prepare<{ user_id: number }, [number]>(rosterSql.members(table, column)),
      ).all(groupId);
      if (rows.length > ROSTER_LIMIT) truncated = true;
      for (const row of rows.slice(0, ROSTER_LIMIT)) members.add(row.user_id);
    }
  return { ids: [...members], truncated };
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

/** The first `ROSTER_LIMIT` of `ids` by username, and whether there were more. */
function byUsername(ctx: Ctx, ids: number[]): { page: number[]; more: boolean } {
  const name = loadUserSummaries(ctx, ids);
  const sorted = ids
    .map((id) => ({ id, key: name(id).username.toLowerCase() }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.id - b.id));
  return {
    page: sorted.slice(0, ROSTER_LIMIT).map((entry) => entry.id),
    more: sorted.length > ROSTER_LIMIT,
  };
}

const MODERATION_IDS: ReadonlySet<string> = new Set(NODE_MODERATION);
const ADMIN_IDS: ReadonlySet<string> = new Set(ADMIN_PERMISSIONS);

export const staffModeratorsOp = implement(staffModerators, (ctx, actor) => {
  requirePermission(ctx, actor, "admin.permissions");
  const tree = getNodeTree(ctx);
  const holders = new Map<number, { everywhere: boolean; nodeIds: number[] }>();
  const found = candidates(ctx, actor, MODERATION_IDS);
  for (const member of memberActors(ctx, actor, found.ids)) {
    const moderated = moderationOf(ctx, member.actor as Exclude<Actor, { kind: "guest" }>);
    if (moderated.everywhere || moderated.nodeIds.length > 0) holders.set(member.id, moderated);
  }
  const { page, more } = byUsername(ctx, [...holders.keys()]);
  const cards = loadMemberCards(ctx, actor, page);
  return {
    truncated: found.truncated || more,
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
  const found = candidates(ctx, actor, ADMIN_IDS);
  for (const member of memberActors(ctx, actor, found.ids)) {
    const held = resolvedPermissions(ctx, member.actor);
    const ids = ADMIN_PERMISSIONS.filter((id) => held[id] === true);
    if (ids.length > 0) holders.set(member.id, ids);
  }
  const { page, more } = byUsername(ctx, [...holders.keys()]);
  const cards = loadMemberCards(ctx, actor, page);
  return {
    truncated: found.truncated || more,
    items: page.flatMap((id) => {
      const card = cards.get(id);
      return card ? [{ card, permissions: holders.get(id)! }] : [];
    }),
  };
});
