import { type Actor, actorUserId } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { GUEST_ACCOUNT_ID } from "../../db/schema";
import { can } from "../../permissions";
import { profileModeAllows } from "../profiles/shared";
import { blockedMembers } from "../social/blocks";
import { isBanned } from "./access";
import { closedProfiles } from "./restricted-cache";

// Numbered pages of the members directory and its rankings. The place of a page is found without
// opening a member's row: the members the viewer is not shown (banned, erased in a ranking,
// profile closed to them) are few, so they are looked up once, and a positional read over the
// sort's index (value and id both in it; the primary key for `newest`) skips them in SQL and
// stops at the last member of the page before. It runs from the nearer end of the list, so it
// passes at most half of it.

const NO_FLOOR = -Number.MAX_SAFE_INTEGER;

export const pageSql = {
  /** Members that carry a ban mark, expired or not: `users_banned`. */
  banned:
    "SELECT id, banned_until, banned_permanently FROM users WHERE banned_permanently = 1 OR banned_until IS NOT NULL",
  /** Erased members: `users_erased`. */
  erased: "SELECT id FROM users WHERE erased_at IS NOT NULL",
  /** Which of the members in `?2` follow the viewer `?1`. */
  followers:
    "SELECT user_id FROM user_follows WHERE followed_id = ?1 AND user_id IN (SELECT value FROM json_each(?2))",
  /** Members in the list, by the sort's own index. `?1` is the floor the figure must exceed. */
  count: (column: string | null, ranked: boolean) =>
    column !== null && ranked
      ? `SELECT count(*) AS n FROM users WHERE ${column} > ?1`
      : "SELECT count(*) AS n FROM users",
  /** Those of the members in `?2` that the list would hold. */
  countAmong: (column: string | null, ranked: boolean) =>
    `SELECT count(*) AS n FROM users WHERE id IN (SELECT value FROM json_each(?2))${
      column !== null && ranked ? ` AND ${column} > ?1` : ""
    }`,
  /** The key of the member at place `?3` (from 0) among those not in `?2`, from either end. */
  key: (column: string | null, fromEnd: boolean) =>
    column === null
      ? `SELECT id FROM users WHERE id NOT IN (SELECT value FROM json_each(?2)) ORDER BY id ${fromEnd ? "ASC" : "DESC"} LIMIT 1 OFFSET ?3`
      : `SELECT ${column} AS value, id FROM users WHERE ${column} > ?1 AND id NOT IN (SELECT value FROM json_each(?2)) ORDER BY ${column} ${fromEnd ? "ASC" : "DESC"}, id ${fromEnd ? "DESC" : "ASC"} LIMIT 1 OFFSET ?3`,
};

/** The members the viewer is not shown in this list, by the cheap rules; the page re-checks each. */
function unlisted(ctx: Ctx, actor: Actor, ranked: boolean): number[] {
  const now = ctx.now();
  // The guest account is never listed.
  const hidden = new Set<number>([GUEST_ACCOUNT_ID]);
  for (const row of prepared(ctx, "members.pageBanned", () =>
    ctx.sqlite.prepare<{ id: number; banned_until: number | null; banned_permanently: number }, []>(
      pageSql.banned,
    ),
  ).all())
    if (isBanned(row, now)) hidden.add(row.id);
  if (ranked)
    for (const row of prepared(ctx, "members.pageErased", () =>
      ctx.sqlite.prepare<{ id: number }, []>(pageSql.erased),
    ).all())
      hidden.add(row.id);
  const viewerId = actorUserId(actor);
  for (const id of blockedMembers(ctx, actor)) hidden.add(id);
  if (can(ctx, actor, "profile.bypassPrivacy")) return [...hidden];
  const closed = closedProfiles(ctx).filter((row) => row.id !== viewerId);
  const followers = new Set(
    viewerId === null
      ? []
      : prepared(ctx, "members.pageFollowers", () =>
          ctx.sqlite.prepare<{ user_id: number }, [number, string]>(pageSql.followers),
        )
          .all(
            viewerId,
            JSON.stringify(closed.filter((row) => row.mode === "followed").map((row) => row.id)),
          )
          .map((row) => row.user_id),
  );
  for (const row of closed)
    if (
      !profileModeAllows(
        {
          profile_view_privacy: row.mode,
          follows: Number(followers.has(row.id)),
        },
        viewerId,
      )
    )
      hidden.add(row.id);
  return [...hidden];
}

export type PageStart = { total: number; start: number[] | null };

/**
 * How many members the list holds for the viewer, and the key of the last member of the page
 * before `page` (null for page 1; also null when `page` lies past the end, which `total` shows).
 * `column` is the sort's figure, null for `newest`; `ranked` leaves out the members at 0 or less.
 */
export function numberedStart(
  ctx: Ctx,
  actor: Actor,
  options: { column: string | null; ranked: boolean; page: number; limit: number },
): PageStart {
  const { column, ranked, page, limit } = options;
  const hidden = JSON.stringify(unlisted(ctx, actor, ranked));
  const floor = ranked ? 0 : NO_FLOOR;
  const base = prepared(ctx, `members.pageCount.${column}.${ranked}`, () =>
    ctx.sqlite.prepare<{ n: number }, number[]>(pageSql.count(column, ranked)),
  ).get(...(column !== null && ranked ? [floor] : []))!.n;
  const among = prepared(ctx, `members.pageCountAmong.${column}.${ranked}`, () =>
    ctx.sqlite.prepare<{ n: number }, [number, string]>(pageSql.countAmong(column, ranked)),
  ).get(floor, hidden)!.n;
  const total = base - among;
  // The member before the page's first: place `before` of the list, counted from the nearer end.
  const before = (page - 1) * limit - 1;
  if (before < 0 || before >= total) return { total, start: null };
  const fromEnd = before >= total / 2;
  const key = prepared(ctx, `members.pageKey.${column}.${fromEnd}`, () =>
    ctx.sqlite.prepare<{ value?: number; id: number }, [number, string, number]>(
      pageSql.key(column, fromEnd),
    ),
  ).get(floor, hidden, fromEnd ? total - 1 - before : before);
  return { total, start: key ? (column === null ? [key.id] : [key.value!, key.id]) : null };
}
