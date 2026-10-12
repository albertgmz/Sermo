import * as z from "zod";
import { type Ctx, prepared } from "../../context";
import { standingsMonth, standingsWinners } from "../../contracts/members";
import { writeTx } from "../../db/tx";
import { implement } from "../../operation";
import { decodeCursor, encodeCursor } from "../../pagination";
import { requirePermission } from "../../permissions";
import { scanKeyset } from "../feed/scan";
import { enqueueJob, registerJobHandler } from "../jobs/queue";
import { readSiteSettings } from "../settings";
import { loadMemberCards } from "./cards";

/** Rows one slice of the recomputation reads before it yields to the event loop. */
const SLICE = 2000;
/** Members written, or stale rows removed, per transaction. */
const WRITE_BATCH = 200;
/** The marker row that says every month up to and including its value has been decided. */
export const DECIDED_KEY = "standings.decided";

export interface MonthStats {
  posts: number;
  reactions: number;
  referrals: number;
}

export const standingSql = {
  /** The first row at or after an id: the probe of the bisection on the primary key. */
  rowAtOrAfter: (table: "posts" | "reactions") =>
    `SELECT id, created_at FROM ${table} WHERE id >= ?1 ORDER BY id LIMIT 1`,
  lastId: (table: "posts" | "reactions") => `SELECT max(id) AS id FROM ${table}`,
  posts:
    "SELECT user_id, thread_id FROM posts WHERE id >= ?1 AND id < ?2 AND state = 'visible' AND created_at >= ?3 AND created_at < ?4",
  visibleThreads:
    "SELECT id FROM threads WHERE state = 'visible' AND id IN (SELECT value FROM json_each(?1))",
  reactions:
    "SELECT content_user_id FROM reactions WHERE id >= ?1 AND id < ?2 AND created_at >= ?3 AND created_at < ?4",
  referrals:
    "SELECT id, referred_by, referred_at FROM users WHERE referred_at >= ?1 AND referred_at < ?2 AND (referred_at, id) > (?3, ?4) ORDER BY referred_at, id LIMIT ?5",
  upsert:
    "INSERT INTO member_month_stats (month, user_id, posts, reactions, referrals, points_tenths) VALUES (?1, ?2, ?3, ?4, ?5, ?6) " +
    "ON CONFLICT (month, user_id) DO UPDATE SET posts = excluded.posts, reactions = excluded.reactions, referrals = excluded.referrals, points_tenths = excluded.points_tenths",
  stored:
    "SELECT user_id FROM member_month_stats WHERE month = ?1 AND user_id > ?2 ORDER BY user_id LIMIT ?3",
  remove:
    "DELETE FROM member_month_stats WHERE month = ?1 AND user_id IN (SELECT value FROM json_each(?2))",
  top: "SELECT user_id, posts, reactions, referrals, points_tenths FROM member_month_stats WHERE month = ?1 ORDER BY points_tenths DESC, posts DESC, user_id LIMIT 1",
  winner: "SELECT 1 FROM month_winners WHERE month = ?1",
  decided: `SELECT value FROM site_settings WHERE key = '${DECIDED_KEY}'`,
  markDecided:
    "INSERT INTO site_settings (key, value, updated_at) VALUES (?1, ?2, ?3) " +
    "ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at WHERE CAST(site_settings.value AS INTEGER) < CAST(excluded.value AS INTEGER)",
  insertWinner:
    "INSERT OR IGNORE INTO month_winners (month, user_id, posts, reactions, referrals, points_tenths, decided_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
  // standings.month: the three ranges of the keyset, each through member_month_stats_standing.
  entryColumns:
    "s.user_id, s.posts, s.reactions, s.referrals, s.points_tenths, u.banned_until, u.banned_permanently",
  sameScore: (columns: string) =>
    `SELECT ${columns} FROM member_month_stats s JOIN users u ON u.id = s.user_id WHERE s.month = ?1 AND s.points_tenths = ?2 AND s.posts = ?3 AND s.user_id > ?4 ORDER BY s.user_id LIMIT ?5`,
  samePoints: (columns: string) =>
    `SELECT ${columns} FROM member_month_stats s JOIN users u ON u.id = s.user_id WHERE s.month = ?1 AND s.points_tenths = ?2 AND s.posts < ?3 ORDER BY s.posts DESC, s.user_id LIMIT ?4`,
  lowerPoints: (columns: string) =>
    `SELECT ${columns} FROM member_month_stats s JOIN users u ON u.id = s.user_id WHERE s.month = ?1 AND s.points_tenths < ?2 ORDER BY s.points_tenths DESC, s.posts DESC, s.user_id LIMIT ?3`,
  winners:
    "SELECT w.month, w.user_id, w.posts, w.reactions, w.referrals, w.points_tenths, u.banned_until, u.banned_permanently FROM month_winners w JOIN users u ON u.id = w.user_id WHERE w.month < ?1 ORDER BY w.month DESC LIMIT ?2",
};

export const monthKey = (year: number, month: number) => year * 100 + month;
const splitMonth = (key: number) => ({ year: Math.floor(key / 100), month: key % 100 });
const monthOf = (ms: number) => {
  const date = new Date(ms);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
};
const previousOf = ({ year, month }: { year: number; month: number }) =>
  month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
const startOf = ({ year, month }: { year: number; month: number }) => Date.UTC(year, month - 1, 1);

const isBanned = (row: { banned_until: number | null; banned_permanently: number }, now: number) =>
  row.banned_permanently === 1 || (row.banned_until !== null && row.banned_until > now);

// The job ---------------------------------------------------------------------------------------

/**
 * The first id of a table whose row was created at or after `at`, found by bisecting on the
 * primary key (about 20 probes): ids grow with time, as in the rankings job.
 */
function firstIdAt(ctx: Ctx, table: "posts" | "reactions", at: number): number {
  const probe = prepared(ctx, `members.standingProbe.${table}`, () =>
    ctx.sqlite.prepare<{ id: number; created_at: number }, [number]>(
      standingSql.rowAtOrAfter(table),
    ),
  );
  const top =
    ctx.sqlite.prepare<{ id: number | null }, []>(standingSql.lastId(table)).get()?.id ?? 0;
  let low = 1;
  let high = top + 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const found = probe.get(middle);
    if (found && found.created_at >= at) high = middle;
    else low = found ? Math.min(found.id + 1, high) : high;
  }
  return low;
}

/**
 * What every member did in a month, in bounded slices (the generator yields between them).
 * Visible posts in visible threads, reactions received, members referred.
 */
function* computeMonth(
  ctx: Ctx,
  window: { year: number; month: number },
): Generator<void, Map<number, MonthStats>, void> {
  const from = startOf(window);
  const to = startOf(
    window.month === 12
      ? { year: window.year + 1, month: 1 }
      : { year: window.year, month: window.month + 1 },
  );
  const stats = new Map<number, MonthStats>();
  const of = (userId: number) => {
    let entry = stats.get(userId);
    if (!entry) {
      entry = { posts: 0, reactions: 0, referrals: 0 };
      stats.set(userId, entry);
    }
    return entry;
  };

  const postSlice = prepared(ctx, "members.standingPosts", () =>
    ctx.sqlite.prepare<{ user_id: number; thread_id: number }, [number, number, number, number]>(
      standingSql.posts,
    ),
  );
  const visibleThreads = prepared(ctx, "members.standingThreads", () =>
    ctx.sqlite.prepare<{ id: number }, [string]>(standingSql.visibleThreads),
  );
  const postsEnd = firstIdAt(ctx, "posts", to);
  for (let low = firstIdAt(ctx, "posts", from); low < postsEnd; low += SLICE) {
    const rows = postSlice.all(low, Math.min(low + SLICE, postsEnd), from, to);
    if (rows.length > 0) {
      const live = new Set(
        visibleThreads
          .all(JSON.stringify([...new Set(rows.map((row) => row.thread_id))]))
          .map((row) => row.id),
      );
      for (const row of rows) if (live.has(row.thread_id)) of(row.user_id).posts++;
    }
    yield;
  }

  const reactionSlice = prepared(ctx, "members.standingReactions", () =>
    ctx.sqlite.prepare<{ content_user_id: number }, [number, number, number, number]>(
      standingSql.reactions,
    ),
  );
  const reactionsEnd = firstIdAt(ctx, "reactions", to);
  for (let low = firstIdAt(ctx, "reactions", from); low < reactionsEnd; low += SLICE) {
    for (const row of reactionSlice.all(low, Math.min(low + SLICE, reactionsEnd), from, to))
      of(row.content_user_id).reactions++;
    yield;
  }

  const referralSlice = prepared(ctx, "members.standingReferrals", () =>
    ctx.sqlite.prepare<
      { id: number; referred_by: number | null; referred_at: number },
      [number, number, number, number, number]
    >(standingSql.referrals),
  );
  let lastAt = from;
  let lastId = 0;
  while (true) {
    const rows = referralSlice.all(from, to, lastAt, lastId, SLICE);
    for (const row of rows) if (row.referred_by !== null) of(row.referred_by).referrals++;
    if (rows.length < SLICE) break;
    lastAt = rows.at(-1)!.referred_at;
    lastId = rows.at(-1)!.id;
    yield;
  }
  return stats;
}

/** The points of a member's month, times ten, from the site's standing settings. */
function pointsTenths(settings: ReturnType<typeof readSiteSettings>, entry: MonthStats): number {
  return Math.round(
    10 *
      (entry.posts * settings.standingPostPoints +
        entry.reactions / settings.standingReactionsPerPoint +
        entry.referrals * settings.standingReferralPoints),
  );
}

/**
 * Makes `member_month_stats` of a month equal to `stats`: members with points are upserted in
 * place and members who no longer have any are removed, a batch per short transaction, so a
 * reader never sees the month empty.
 */
function* storeMonth(
  ctx: Ctx,
  key: number,
  stats: Map<number, MonthStats>,
): Generator<void, void, void> {
  const settings = readSiteSettings(ctx);
  const scored = [...stats]
    .map(([userId, entry]) => ({ userId, entry, tenths: pointsTenths(settings, entry) }))
    .filter((row) => row.tenths > 0)
    .sort((a, b) => a.userId - b.userId);
  const upsert = prepared(ctx, "members.standingUpsert", () =>
    ctx.sqlite.prepare<unknown, [number, number, number, number, number, number]>(
      standingSql.upsert,
    ),
  );
  for (let at = 0; at < scored.length; at += WRITE_BATCH) {
    writeTx(ctx, () => {
      for (const row of scored.slice(at, at + WRITE_BATCH))
        upsert.run(
          key,
          row.userId,
          row.entry.posts,
          row.entry.reactions,
          row.entry.referrals,
          row.tenths,
        );
    });
    yield;
  }
  const keep = new Set(scored.map((row) => row.userId));
  const stored = prepared(ctx, "members.standingStored", () =>
    ctx.sqlite.prepare<{ user_id: number }, [number, number, number]>(standingSql.stored),
  );
  const remove = prepared(ctx, "members.standingRemove", () =>
    ctx.sqlite.prepare<unknown, [number, string]>(standingSql.remove),
  );
  let after = 0;
  while (true) {
    const rows = stored.all(key, after, WRITE_BATCH);
    const stale = rows.map((row) => row.user_id).filter((id) => !keep.has(id));
    if (stale.length > 0) writeTx(ctx, () => remove.run(key, JSON.stringify(stale)));
    if (rows.length < WRITE_BATCH) break;
    after = rows.at(-1)!.user_id;
    yield;
  }
}

/**
 * Decides the previous month once: its winner goes into `month_winners`, or, when nobody
 * scored, only the marker row `standings.decided` in `site_settings` records that the month is
 * settled so it is not recomputed again. The marker holds the latest decided month.
 */
function* decidePrevious(
  ctx: Ctx,
  previous: { year: number; month: number },
): Generator<void, void, void> {
  const key = monthKey(previous.year, previous.month);
  const settled = () => {
    const marker = prepared(ctx, "members.standingDecided", () =>
      ctx.sqlite.prepare<{ value: string }, []>(standingSql.decided),
    ).get();
    return (
      (marker !== null && marker !== undefined && Number(marker.value) >= key) ||
      !!prepared(ctx, "members.standingWinner", () =>
        ctx.sqlite.prepare<{ 1: number }, [number]>(standingSql.winner),
      ).get(key)
    );
  };
  if (settled()) return;
  const stats = yield* computeMonth(ctx, previous);
  yield* storeMonth(ctx, key, stats);
  writeTx(ctx, () => {
    if (settled()) return;
    const top = prepared(ctx, "members.standingTop", () =>
      ctx.sqlite.prepare<
        {
          user_id: number;
          posts: number;
          reactions: number;
          referrals: number;
          points_tenths: number;
        },
        [number]
      >(standingSql.top),
    ).get(key);
    const now = ctx.now();
    if (top)
      prepared(ctx, "members.standingInsertWinner", () =>
        ctx.sqlite.prepare<unknown, [number, number, number, number, number, number, number]>(
          standingSql.insertWinner,
        ),
      ).run(key, top.user_id, top.posts, top.reactions, top.referrals, top.points_tenths, now);
    prepared(ctx, "members.standingMark", () =>
      ctx.sqlite.prepare<unknown, [string, string, number]>(standingSql.markDecided),
    ).run(DECIDED_KEY, String(key), now);
  });
  yield;
}

function* recompute(ctx: Ctx): Generator<void, void, void> {
  const current = monthOf(ctx.now());
  yield* decidePrevious(ctx, previousOf(current));
  const stats = yield* computeMonth(ctx, current);
  yield* storeMonth(ctx, monthKey(current.year, current.month), stats);
}

/** Recomputes the standings now, without yielding. For tests and administration tools. */
export function refreshStandings(ctx: Ctx): void {
  const run = recompute(ctx);
  while (!run.next().done);
}

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Registers the refresh job and queues one now, so the standings exist right after a start
 * instead of after the next tenth minute. The unique key keeps a restart loop from piling them up.
 */
export function registerStandingJobs(ctx: Ctx): void {
  registerJobHandler(ctx, "standings.refresh", async (context) => {
    const run = recompute(context);
    while (!run.next().done) await yieldToEventLoop();
  });
  enqueueJob(ctx, "standings.refresh", {}, { uniqueKey: "standings.refresh" });
}

// Reads -----------------------------------------------------------------------------------------

interface EntryRow {
  user_id: number;
  posts: number;
  reactions: number;
  referrals: number;
  points_tenths: number;
  banned_until: number | null;
  banned_permanently: number;
}

const StandingCursor = z.tuple([z.number().int(), z.number().int(), z.number().int().positive()]);

export const standingsMonthOp = implement(standingsMonth, (ctx, actor, input) => {
  requirePermission(ctx, actor, "profile.view");
  const now = ctx.now();
  const current = monthOf(now);
  const window = input.month === "current" ? current : previousOf(current);
  const key = monthKey(window.year, window.month);
  const same = prepared(ctx, "members.standingSame", () =>
    ctx.sqlite.prepare<EntryRow, [number, number, number, number, number]>(
      standingSql.sameScore(standingSql.entryColumns),
    ),
  );
  const samePoints = prepared(ctx, "members.standingSamePoints", () =>
    ctx.sqlite.prepare<EntryRow, [number, number, number, number]>(
      standingSql.samePoints(standingSql.entryColumns),
    ),
  );
  const lower = prepared(ctx, "members.standingLower", () =>
    ctx.sqlite.prepare<EntryRow, [number, number, number]>(
      standingSql.lowerPoints(standingSql.entryColumns),
    ),
  );
  const scan = scanKeyset<EntryRow, [number, number, number]>({
    before: input.cursor ? decodeCursor(input.cursor, StandingCursor) : null,
    limit: input.limit,
    fetch: (before, count) => {
      if (!before) return lower.all(key, Number.MAX_SAFE_INTEGER, count);
      const [points, posts, userId] = before;
      const rows = same.all(key, points, posts, userId, count);
      if (rows.length < count)
        rows.push(...samePoints.all(key, points, posts, count - rows.length));
      if (rows.length < count) rows.push(...lower.all(key, points, count - rows.length));
      return rows;
    },
    keyOf: (row) => [row.points_tenths, row.posts, row.user_id],
    accept: (rows) => new Set(rows.filter((row) => !isBanned(row, now))),
  });
  const cards = loadMemberCards(
    ctx,
    actor,
    scan.items.map((row) => row.user_id),
  );
  return {
    items: scan.items.flatMap((row) => {
      const card = cards.get(row.user_id);
      return card
        ? [
            {
              card,
              posts: row.posts,
              reactions: row.reactions,
              referrals: row.referrals,
              points: row.points_tenths / 10,
            },
          ]
        : [];
    }),
    nextCursor: scan.next ? encodeCursor(scan.next) : null,
    year: window.year,
    month: window.month,
  };
});

interface WinnerRow extends EntryRow {
  month: number;
}

export const standingsWinnersOp = implement(standingsWinners, (ctx, actor, input) => {
  requirePermission(ctx, actor, "profile.view");
  const now = ctx.now();
  const current = monthOf(now);
  const statement = prepared(ctx, "members.standingWinners", () =>
    ctx.sqlite.prepare<WinnerRow, [number, number]>(standingSql.winners),
  );
  const scan = scanKeyset<WinnerRow, [number]>({
    before: null,
    limit: input.limit,
    fetch: (before, count) =>
      statement.all(before ? before[0] : monthKey(current.year, current.month), count),
    keyOf: (row) => [row.month],
    accept: (rows) => new Set(rows.filter((row) => !isBanned(row, now))),
  });
  const cards = loadMemberCards(
    ctx,
    actor,
    scan.items.map((row) => row.user_id),
  );
  return {
    items: scan.items.flatMap((row) => {
      const card = cards.get(row.user_id);
      return card
        ? [
            {
              ...splitMonth(row.month),
              card,
              posts: row.posts,
              reactions: row.reactions,
              referrals: row.referrals,
              points: row.points_tenths / 10,
            },
          ]
        : [];
    }),
  };
});
