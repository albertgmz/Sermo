import * as z from "zod";
import { type Ctx, prepared } from "../../context";
import { type MEMBER_SORTS, usersBirthdays, usersList, usersStaff } from "../../contracts/members";
import { implement } from "../../operation";
import { decodeCursor, encodeCursor } from "../../pagination";
import { requirePermission } from "../../permissions";
import { loadUserSummaries } from "../../shared/users";
import { iso } from "../../time";
import { scanKeyset } from "../feed/scan";
import { isBanned, openableProfiles } from "./access";
import { loadMemberCards } from "./cards";
import { requireSiteView } from "./site-access";

type Sort = (typeof MEMBER_SORTS)[number];

/** The most members the staff list holds. */
export const STAFF_LIMIT = 200;
/** The most members the birthday list holds. */
export const BIRTHDAY_LIMIT = 50;

// users.list ------------------------------------------------------------------------------------

const SORT_COLUMN: Record<Exclude<Sort, "newest">, string> = {
  posts: "post_count",
  reactions: "reaction_score",
  level: "award_xp",
  credits: "credits",
  awards: "award_count",
  referrals: "referral_count",
};
const LIST_COLUMNS =
  "id, created_at, post_count, reaction_score, award_xp, credits, award_count, referral_count, banned_until, banned_permanently, erased_at";

interface ListRow {
  id: number;
  created_at: number;
  post_count: number;
  reaction_score: number;
  award_xp: number;
  credits: number;
  award_count: number;
  referral_count: number;
  banned_until: number | null;
  banned_permanently: number;
  erased_at: number | null;
}

/**
 * The statements of a sort. `newest` walks the primary key backwards. The others walk their
 * index (value descending, id ascending) in two ranges: the rest of the current value
 * (`tie`: same value, higher id) and then the lower values (`below`).
 */
export const listSql = {
  newest: `SELECT ${LIST_COLUMNS} FROM users WHERE id < ?1 ORDER BY id DESC LIMIT ?2`,
  tie: (sort: Exclude<Sort, "newest">) =>
    `SELECT ${LIST_COLUMNS} FROM users WHERE ${SORT_COLUMN[sort]} = ?1 AND id > ?2 ORDER BY id LIMIT ?3`,
  /** `?3` is the value the rows must exceed: `NO_FLOOR` lists every member, 0 only those who scored. */
  below: (sort: Exclude<Sort, "newest">) =>
    `SELECT ${LIST_COLUMNS} FROM users WHERE ${SORT_COLUMN[sort]} < ?1 AND ${SORT_COLUMN[sort]} > ?3 ORDER BY ${SORT_COLUMN[sort]} DESC, id LIMIT ?2`,
};

const NO_FLOOR = -Number.MAX_SAFE_INTEGER;
const NumericCursor = z.tuple([z.number().int(), z.number().int().positive()]);
const NewestCursor = z.tuple([z.number().int().positive()]);

export const usersListOp = implement(usersList, (ctx, actor, input) => {
  requireSiteView(ctx, actor);
  requirePermission(ctx, actor, "profile.view");
  requirePermission(ctx, actor, "member.viewList");
  const now = ctx.now();
  const sort = input.sort;
  const accept = (rows: ListRow[]) => {
    const open = openableProfiles(
      ctx,
      actor,
      rows.map((row) => row.id),
    );
    return new Set(
      rows.filter((row) => row.erased_at === null && !isBanned(row, now) && open.has(row.id)),
    );
  };

  const floor = input.ranked ? 0 : NO_FLOOR;
  let items: ListRow[];
  let next: number[] | null;
  if (sort === "newest") {
    const statement = prepared(ctx, "members.listNewest", () =>
      ctx.sqlite.prepare<ListRow, [number, number]>(listSql.newest),
    );
    const scan = scanKeyset<ListRow, [number]>({
      before: input.cursor ? [decodeCursor(input.cursor, NewestCursor)[0]] : null,
      limit: input.limit,
      fetch: (before, count) => statement.all(before ? before[0] : Number.MAX_SAFE_INTEGER, count),
      keyOf: (row) => [row.id],
      accept,
    });
    items = scan.items;
    next = scan.next;
  } else {
    const column = SORT_COLUMN[sort] as keyof ListRow;
    const tie = prepared(ctx, `members.listTie.${sort}`, () =>
      ctx.sqlite.prepare<ListRow, [number, number, number]>(listSql.tie(sort)),
    );
    const below = prepared(ctx, `members.listBelow.${sort}`, () =>
      ctx.sqlite.prepare<ListRow, [number, number, number]>(listSql.below(sort)),
    );
    const scan = scanKeyset<ListRow, [number, number]>({
      before: input.cursor ? decodeCursor(input.cursor, NumericCursor) : null,
      limit: input.limit,
      fetch: (before, count) => {
        if (!before) return below.all(Number.MAX_SAFE_INTEGER, count, floor);
        const same = before[0] > floor ? tie.all(before[0], before[1], count) : [];
        return same.length >= count
          ? same
          : [...same, ...below.all(before[0], count - same.length, floor)];
      },
      keyOf: (row) => [row[column] as number, row.id],
      accept,
    });
    items = scan.items;
    next = scan.next;
  }
  const cards = loadMemberCards(
    ctx,
    actor,
    items.map((row) => row.id),
  );
  return {
    items: items.flatMap((row) => {
      const card = cards.get(row.id);
      return card
        ? [
            {
              card,
              createdAt: iso(row.created_at),
              postCount: row.post_count,
              reactionScore: row.reaction_score,
              awardXp: row.award_xp,
              credits: row.credits,
              awardCount: row.award_count,
              referralCount: row.referral_count,
            },
          ]
        : [];
    }),
    nextCursor: next ? encodeCursor(next) : null,
  };
});

// users.staff -----------------------------------------------------------------------------------

export const staffSql = {
  groups: "SELECT id, title, rank FROM groups WHERE is_staff = 1",
  /** Members of the staff groups `?1` through one source; `users_group`, `user_groups_group`, ... */
  members: (table: "users" | "user_groups" | "user_group_grants" | "shop_group_grants") =>
    `SELECT t.${table === "users" ? "id" : "user_id"} AS user_id, j.value AS group_id FROM json_each(?1) AS j CROSS JOIN ${table} AS t ON t.group_id = j.value LIMIT ${STAFF_LIMIT}`,
};
export const staffBanSql =
  "SELECT id, banned_until, banned_permanently FROM users WHERE id IN (SELECT value FROM json_each(?1))";
const STAFF_SOURCES = ["users", "user_groups", "user_group_grants", "shop_group_grants"] as const;

/**
 * The members of the staff groups (primary, by hand, by promotion or bought) who are not banned,
 * with the staff groups each holds, and the staff groups highest rank first. At most
 * `STAFF_LIMIT` members per source.
 */
export function staffMembership(ctx: Ctx) {
  const groups = prepared(ctx, "members.staffGroups", () =>
    ctx.sqlite.prepare<{ id: number; title: string; rank: number }, []>(staffSql.groups),
  ).all();
  const staffGroupsOf = new Map<number, Set<number>>();
  if (groups.length === 0) return { groups, staffGroupsOf };
  // Highest rank first, so the per-source limit keeps the highest groups' members.
  groups.sort((a, b) => b.rank - a.rank || a.id - b.id);
  const groupJson = JSON.stringify(groups.map((group) => group.id));
  for (const source of STAFF_SOURCES)
    for (const row of prepared(ctx, `members.staff.${source}`, () =>
      ctx.sqlite.prepare<{ user_id: number; group_id: number }, [string]>(staffSql.members(source)),
    ).all(groupJson)) {
      const held = staffGroupsOf.get(row.user_id) ?? new Set<number>();
      held.add(row.group_id);
      staffGroupsOf.set(row.user_id, held);
    }
  const now = ctx.now();
  for (const row of prepared(ctx, "members.staffBans", () =>
    ctx.sqlite.prepare<
      { id: number; banned_until: number | null; banned_permanently: number },
      [string]
    >(staffBanSql),
  ).all(JSON.stringify([...staffGroupsOf.keys()])))
    if (isBanned(row, now)) staffGroupsOf.delete(row.id);
  return { groups, staffGroupsOf };
}

export const usersStaffOp = implement(usersStaff, (ctx, actor) => {
  requireSiteView(ctx, actor);
  requirePermission(ctx, actor, "profile.view");
  requirePermission(ctx, actor, "member.viewList");
  const { groups, staffGroupsOf } = staffMembership(ctx);
  if (groups.length === 0) return { items: [] };
  const byId = new Map(groups.map((group) => [group.id, group]));
  const username = loadUserSummaries(ctx, staffGroupsOf.keys());
  const ranked = [...staffGroupsOf].map(([userId, held]) => {
    const mine = [...held]
      .map((id) => byId.get(id)!)
      .sort((a, b) => b.rank - a.rank || a.id - b.id);
    return { userId, name: username(userId).username.toLowerCase(), mine };
  });
  ranked.sort(
    (a, b) =>
      b.mine[0]!.rank - a.mine[0]!.rank ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : a.userId - b.userId),
  );
  const page = ranked.slice(0, STAFF_LIMIT);
  const cards = loadMemberCards(
    ctx,
    actor,
    page.map((row) => row.userId),
  );
  return {
    items: page.flatMap((row) => {
      const card = cards.get(row.userId);
      return card ? [{ card, groups: row.mine.map((group) => group.title) }] : [];
    }),
  };
});

// users.birthdays -------------------------------------------------------------------------------

export const birthdaySql = `SELECT id, banned_until, banned_permanently FROM users WHERE birthday_md = ?1 AND id > ?2 ORDER BY id LIMIT ?3`;

export const usersBirthdaysOp = implement(usersBirthdays, (ctx, actor) => {
  requireSiteView(ctx, actor);
  requirePermission(ctx, actor, "profile.view");
  requirePermission(ctx, actor, "member.viewList");
  const now = ctx.now();
  const today = new Date(now);
  const day = `${String(today.getUTCMonth() + 1).padStart(2, "0")}-${String(today.getUTCDate()).padStart(2, "0")}`;
  const statement = prepared(ctx, "members.birthdays", () =>
    ctx.sqlite.prepare<
      { id: number; banned_until: number | null; banned_permanently: number },
      [string, number, number]
    >(birthdaySql),
  );
  // In a year without a 29th, those born on 29 February celebrate on the 28th.
  const leapDay =
    day === "02-28" && new Date(Date.UTC(today.getUTCFullYear(), 1, 29)).getUTCMonth() !== 1;
  const scan = scanKeyset({
    before: null as number | null,
    limit: BIRTHDAY_LIMIT,
    fetch: (before, count) => {
      const rows = statement.all(day, before ?? 0, count);
      if (!leapDay) return rows;
      return [...rows, ...statement.all("02-29", before ?? 0, count)]
        .sort((a, b) => a.id - b.id)
        .slice(0, count);
    },
    keyOf: (row) => row.id,
    accept: (rows) => {
      const open = openableProfiles(
        ctx,
        actor,
        rows.map((row) => row.id),
      );
      return new Set(rows.filter((row) => !isBanned(row, now) && open.has(row.id)));
    },
  });
  const cards = loadMemberCards(
    ctx,
    actor,
    scan.items.map((row) => row.id),
  );
  return { items: scan.items.flatMap((row) => cards.get(row.id) ?? []) };
});
