import * as z from "zod";
import { requireAuthenticated } from "../../actor";
import { prepared } from "../../context";
import {
  type MEMBER_SORTS,
  usersBirthdays,
  usersList,
  usersSetReferrer,
  usersStaff,
} from "../../contracts/members";
import { writeTx } from "../../db/tx";
import { ConflictError, NotFoundError, ValidationError } from "../../errors";
import { implement } from "../../operation";
import { decodeCursor, encodeCursor } from "../../pagination";
import { currentActor, requirePermission } from "../../permissions";
import { loadUserSummaries } from "../../shared/users";
import { iso } from "../../time";
import { scanKeyset } from "../feed/scan";
import { isBanned, openableProfiles } from "./access";
import { loadMemberCards } from "./cards";

type Sort = (typeof MEMBER_SORTS)[number];

/** A member may name a referrer only while their account is younger than this. */
export const REFERRAL_WINDOW_MS = 7 * 86_400_000;
interface ReferralRow {
  referred_by: number | null;
  created_at: number;
  banned_until: number | null;
  banned_permanently: number;
}

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
  "id, created_at, post_count, reaction_score, award_xp, credits, award_count, referral_count, banned_until, banned_permanently";

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
  below: (sort: Exclude<Sort, "newest">) =>
    `SELECT ${LIST_COLUMNS} FROM users WHERE ${SORT_COLUMN[sort]} < ?1 ORDER BY ${SORT_COLUMN[sort]} DESC, id LIMIT ?2`,
};

const NumericCursor = z.tuple([z.number().int(), z.number().int().positive()]);
const NewestCursor = z.tuple([z.number().int().positive()]);

export const usersListOp = implement(usersList, (ctx, actor, input) => {
  requirePermission(ctx, actor, "profile.view");
  const now = ctx.now();
  const sort = input.sort;
  const accept = (rows: ListRow[]) => {
    const open = openableProfiles(
      ctx,
      actor,
      rows.map((row) => row.id),
    );
    return new Set(rows.filter((row) => !isBanned(row, now) && open.has(row.id)));
  };

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
      ctx.sqlite.prepare<ListRow, [number, number]>(listSql.below(sort)),
    );
    const scan = scanKeyset<ListRow, [number, number]>({
      before: input.cursor ? decodeCursor(input.cursor, NumericCursor) : null,
      limit: input.limit,
      fetch: (before, count) => {
        if (!before) return below.all(Number.MAX_SAFE_INTEGER, count);
        const same = tie.all(before[0], before[1], count);
        return same.length >= count
          ? same
          : [...same, ...below.all(before[0], count - same.length)];
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

export const usersStaffOp = implement(usersStaff, (ctx, actor) => {
  requirePermission(ctx, actor, "profile.view");
  const groups = prepared(ctx, "members.staffGroups", () =>
    ctx.sqlite.prepare<{ id: number; title: string; rank: number }, []>(staffSql.groups),
  ).all();
  if (groups.length === 0) return { items: [] };
  // Highest rank first, so the per-source limit keeps the highest groups' members.
  groups.sort((a, b) => b.rank - a.rank || a.id - b.id);
  const groupJson = JSON.stringify(groups.map((group) => group.id));
  const staffGroupsOf = new Map<number, Set<number>>();
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
  requirePermission(ctx, actor, "profile.view");
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

// users.setReferrer -----------------------------------------------------------------------------

export const usersSetReferrerOp = implement(usersSetReferrer, (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  requirePermission(ctx, actor, "profile.editOwn");
  if (input.userId === user.userId)
    throw new ValidationError("You cannot name yourself as your referrer.");
  return writeTx(ctx, () => {
    // The actor may have lost the permission, or been banned, since the request began.
    requirePermission(ctx, currentActor(ctx, actor), "profile.editOwn");
    const read = (id: number) =>
      prepared(ctx, "members.referralRow", () =>
        ctx.sqlite.prepare<ReferralRow, [number]>(
          "SELECT referred_by, created_at, banned_until, banned_permanently FROM users WHERE id = ?1",
        ),
      ).get(id);
    // Re-read inside the transaction: another process may have changed either row.
    const me = read(user.userId);
    if (!me) throw new NotFoundError();
    const referrer = read(input.userId);
    if (!referrer || isBanned(referrer, ctx.now())) throw new NotFoundError();
    if (me.referred_by !== null) throw new ConflictError("You already named a referrer.");
    if (ctx.now() - me.created_at >= REFERRAL_WINDOW_MS)
      throw new ConflictError("A referrer can only be named in the first seven days.");
    if (referrer.referred_by === user.userId)
      throw new ConflictError("That member named you as their referrer.");
    const changed = prepared(ctx, "members.setReferrer", () =>
      ctx.sqlite.prepare<unknown, [number, number, number]>(
        "UPDATE users SET referred_by = ?1, referred_at = ?2 WHERE id = ?3 AND referred_by IS NULL",
      ),
    ).run(input.userId, ctx.now(), user.userId).changes;
    if (changed === 0) throw new ConflictError("You already named a referrer.");
    prepared(ctx, "members.countReferral", () =>
      ctx.sqlite.prepare<unknown, [number]>(
        "UPDATE users SET referral_count = referral_count + 1 WHERE id = ?1",
      ),
    ).run(input.userId);
    return { ok: true as const };
  });
});
