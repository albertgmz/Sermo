import { type Actor, actorUserId } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { ForbiddenError, NotFoundError } from "../../errors";
import { markPublic } from "../../operation";
import {
  can,
  currentVersions,
  memberActor,
  PRINCIPAL_COLUMNS,
  type PrincipalRow,
} from "../../permissions";

/**
 * A block is mutual: when A blocks B, neither sees the other. The one exception is staff (members
 * with `moderation.access`): a block a member made against them hides nothing from them, so they
 * still see and act on everything of that member. A block staff make themselves applies to them
 * as to anyone.
 */
export const blockSql = {
  /** The blocks between a member and a page of others, each with its side (two index probes). */
  among:
    "SELECT blocked_id AS id, 1 AS mine FROM user_blocks WHERE user_id = ?1 AND blocked_id IN (SELECT value FROM json_each(?2)) " +
    "UNION ALL SELECT user_id AS id, 0 AS mine FROM user_blocks WHERE blocked_id = ?1 AND user_id IN (SELECT value FROM json_each(?2))",
  /** The block between two members, whoever made it. */
  pair:
    "SELECT user_id FROM user_blocks WHERE user_id = ?1 AND blocked_id = ?2 " +
    "UNION ALL SELECT user_id FROM user_blocks WHERE user_id = ?2 AND blocked_id = ?1",
  principal: `SELECT u.id, u.group_id, ${PRINCIPAL_COLUMNS} FROM users u WHERE u.id = ?1`,
  /** Every block of a member, each with its side (`user_blocks_pair`, `user_blocks_blocked`). */
  all:
    "SELECT blocked_id AS id, 1 AS mine FROM user_blocks WHERE user_id = ?1 " +
    "UNION ALL SELECT user_id AS id, 0 AS mine FROM user_blocks WHERE blocked_id = ?1",
} as const;

type Sides = { mine: Set<number>; theirs: Set<number> };

function sides(ctx: Ctx, viewerId: number | null, ids: Iterable<number>): Sides {
  const unique = [...new Set(ids)].filter((id) => id !== viewerId);
  const result: Sides = { mine: new Set(), theirs: new Set() };
  if (viewerId === null || unique.length === 0) return result;
  for (const row of prepared(ctx, "blocks.among", () =>
    ctx.sqlite.prepare<{ id: number; mine: number }, [number, string]>(blockSql.among),
  ).all(viewerId, JSON.stringify(unique)))
    (row.mine === 1 ? result.mine : result.theirs).add(row.id);
  return result;
}

/** Staff, whom a block made by someone else hides nothing from. */
export function seesPastBlocks(ctx: Ctx, actor: Actor): boolean {
  return can(ctx, actor, "moderation.access");
}

/**
 * Members among `ids` the viewer must not see because of a block: the ones the viewer blocked and
 * the ones who blocked the viewer (unless the viewer is staff). Empty for guests. One query.
 */
export const blockedAmong = markPublic(
  "Filters by the blocks of the viewer; reveals nothing about other members.",
  function blockedAmong(ctx: Ctx, actor: Actor, ids: Iterable<number>): Set<number> {
    const found = sides(ctx, actorUserId(actor), ids);
    if (found.theirs.size === 0 || seesPastBlocks(ctx, actor)) return found.mine;
    return new Set([...found.mine, ...found.theirs]);
  },
);

/** `rows` without those whose author is in a block with the viewer (see `blockedAmong`). */
export const withoutBlocked = markPublic(
  "Filters by the blocks of the viewer; the caller decides what the viewer may see.",
  function withoutBlocked<Row extends { user_id: number }>(
    ctx: Ctx,
    actor: Actor,
    rows: Row[],
  ): Row[] {
    const blocked = blockedAmong(
      ctx,
      actor,
      rows.map((row) => row.user_id),
    );
    return blocked.size === 0 ? rows : rows.filter((row) => !blocked.has(row.user_id));
  },
);

/**
 * Every member the viewer must not see because of a block (see `blockedAmong`), for lists that
 * place their pages without reading members one by one. Empty for guests. One query.
 */
export const blockedMembers = markPublic(
  "Reads the blocks of the viewer; reveals nothing about other members.",
  function blockedMembers(ctx: Ctx, actor: Actor): number[] {
    const viewerId = actorUserId(actor);
    if (viewerId === null) return [];
    const rows = prepared(ctx, "blocks.all", () =>
      ctx.sqlite.prepare<{ id: number; mine: number }, [number]>(blockSql.all),
    ).all(viewerId);
    const staff = rows.some((row) => row.mine === 0) && seesPastBlocks(ctx, actor);
    return rows.filter((row) => row.mine === 1 || !staff).map((row) => row.id);
  },
);

/** Whether a block stands between two members, whoever made it. */
export function blockedPair(ctx: Ctx, userId: number, otherId: number): boolean {
  return !!prepared(ctx, "blocks.pair", () =>
    ctx.sqlite.prepare<{ user_id: number }, [number, number]>(blockSql.pair),
  ).get(userId, otherId);
}

/**
 * Refuses an act of the actor toward another member (follow, react, post on their profile, send a
 * gift) when a block stands between them, whoever made it: NotFoundError when the other member's
 * block hides them from the actor, ForbiddenError otherwise.
 */
export const refuseBlocked = markPublic(
  "Refuses acts between two members in a block; the caller checks its own permission.",
  function refuseBlocked(ctx: Ctx, actor: Actor, otherId: number): void {
    const viewerId = actorUserId(actor);
    if (viewerId === null || viewerId === otherId) return;
    const found = sides(ctx, viewerId, [otherId]);
    if (found.mine.size > 0) throw new ForbiddenError();
    if (found.theirs.size > 0)
      throw seesPastBlocks(ctx, actor) ? new ForbiddenError() : new NotFoundError();
  },
);

/**
 * Whether a member, read from their stored principal, holds one of the permissions that lift a
 * block: `moderation.access` (staff, see `seesPastBlocks`) or `conversation.alwaysInvite`.
 */
export function memberHolds(
  ctx: Ctx,
  userId: number,
  id: "moderation.access" | "conversation.alwaysInvite",
): boolean {
  const row = prepared(ctx, "blocks.principal", () =>
    ctx.sqlite.prepare<PrincipalRow & { id: number; group_id: number }, [number]>(
      blockSql.principal,
    ),
  ).get(userId);
  return !!row && can(ctx, memberActor(row.id, row.group_id, row, currentVersions(ctx)), id);
}

/** The blocks between a member and others, by side: `mine` they made, `theirs` made against them. */
export function blockSides(ctx: Ctx, userId: number, ids: Iterable<number>) {
  return sides(ctx, userId, ids);
}
