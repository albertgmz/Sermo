import type { Ctx } from "../../context";
import { prepared } from "../../context";
import { PLACE_KINDS } from "../../contracts/members";
import { holdCheckpoints, paceWal } from "../../db/checkpointer";
import { writeTx } from "../../db/tx";
import { robotOf } from "./online-robots";

/**
 * The header the web app names the page being rendered with (`forum:12`, `thread:345`,
 * `member:6`, or a kind alone). Only a page view carries it, so only page views are noted; any
 * other value is the place `page`. The web app sends the same name (`PLACE_HEADER` in its
 * `lib/sermo/transport.ts`).
 */
export const PLACE_HEADER = "x-sermo-place";

/** How long a visitor is kept after their last page view, and their place shown. */
export const VISIT_KEEP_MS = 60 * 60_000;
/**
 * Guests and robots noted between flushes; past this a new one waits for a later page view.
 * Members are not counted against it: they are bounded by the accounts in use, and a flood of
 * guests must not take their places away.
 */
export const MAX_PENDING_GUESTS = 5_000;
/**
 * Guests and robots kept in the table; past this a new one is not stored until the prune frees
 * room (one already stored is still updated). Anyone can make up an address and user agent pair,
 * so the table, and the list read from it, stay bounded whatever arrives.
 */
export const MAX_STORED_GUESTS = 10_000;
/**
 * Rows the prune and the flush write per transaction. The flush's chunk is small so a request
 * between two of them waits about a millisecond, not for the whole flush.
 */
export const PRUNE_CHUNK = 500;
export const FLUSH_CHUNK = 100;

export type PlaceKind = (typeof PLACE_KINDS)[number];
export interface RawPlace {
  kind: PlaceKind;
  id: number | null;
}
export interface Visit {
  userId: number | null;
  robot: string | null;
  place: RawPlace;
  ip: string | null;
  at: number;
}

const TARGETED = new Set<PlaceKind>(["forum", "thread", "member"]);
const BARE = new Set<string>(PLACE_KINDS.filter((kind) => !TARGETED.has(kind)));

/** What a place header names; anything it cannot name is the place `page`. */
export function parsePlace(value: string): RawPlace {
  const match = /^(forum|thread|member):([1-9]\d{0,14})$/.exec(value);
  if (match) return { kind: match[1] as PlaceKind, id: Number(match[2]) };
  return BARE.has(value) ? { kind: value as PlaceKind, id: null } : { kind: "page", id: null };
}

export const memberVisitKey = (userId: number) => `u:${userId}`;

// The key of a guest: the address and user agent hashed with the site's secret, so the table
// cannot be matched to an address without it. A process without a configured secret (tests,
// tools) uses one of its own.
const ownSalt = crypto.randomUUID();
function guestKey(ctx: Ctx, ip: string, userAgent: string): string {
  const hasher = new Bun.CryptoHasher("sha256", ctx.config.auth?.secret ?? ownSalt);
  hasher.update(`${ip}\n${userAgent}`);
  return `g:${hasher.digest("hex").slice(0, 32)}`;
}

interface Pending {
  visits: Map<string, Visit>;
  /** How many of `visits` are guests or robots. */
  guests: number;
}
const pending = new WeakMap<Ctx, Pending>();

function pendingOf(ctx: Ctx): Pending {
  let state = pending.get(ctx);
  if (!state) {
    state = { visits: new Map(), guests: 0 };
    pending.set(ctx, state);
  }
  return state;
}

/**
 * Notes a page view: a member's, or a guest's or robot's by address and user agent. Never writes:
 * a map entry per visitor, written by `flushVisits`. Robots are told apart once per visitor
 * between flushes.
 */
export function noteVisit(
  ctx: Ctx,
  visit: { userId: number | null; ip?: string; userAgent?: string; place: string },
): void {
  const state = pendingOf(ctx);
  const userAgent = visit.userAgent ?? "";
  const ip = visit.ip && visit.ip !== "unknown" ? visit.ip : null;
  const key =
    visit.userId === null ? guestKey(ctx, ip ?? "", userAgent) : memberVisitKey(visit.userId);
  const known = state.visits.get(key);
  if (!known && visit.userId === null) {
    if (state.guests >= MAX_PENDING_GUESTS) return;
    state.guests += 1;
  }
  state.visits.set(key, {
    userId: visit.userId,
    robot: known ? known.robot : visit.userId === null ? robotOf(userAgent) : null,
    place: parsePlace(visit.place),
    ip: visit.userId === null ? ip : null,
    at: ctx.now(),
  });
}

/** The notes not written yet, by visitor key. */
export function pendingVisits(ctx: Ctx): ReadonlyMap<string, Visit> {
  return pending.get(ctx)?.visits ?? new Map();
}

export const onlineVisitSql = {
  // From `users` for a member, so a member deleted since the note leaves no row and no error.
  upsert:
    "INSERT INTO online_visitors (visitor_key, user_id, robot, place_kind, place_id, ip, seen_at) " +
    "SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7 WHERE ?2 IS NULL OR EXISTS (SELECT 1 FROM users WHERE id = ?2) " +
    "ON CONFLICT (visitor_key) DO UPDATE SET robot = excluded.robot, place_kind = excluded.place_kind, " +
    "place_id = excluded.place_id, ip = excluded.ip, seen_at = excluded.seen_at " +
    "WHERE excluded.seen_at >= online_visitors.seen_at",
  guestCount: "SELECT count(*) AS n FROM online_visitors WHERE user_id IS NULL",
  // A guest already stored is moved on; a new one is stored only while there is room.
  guestTouch:
    "UPDATE online_visitors SET robot = ?2, place_kind = ?3, place_id = ?4, ip = ?5, seen_at = ?6 " +
    "WHERE visitor_key = ?1 AND seen_at <= ?6",
  guestInsert:
    "INSERT INTO online_visitors (visitor_key, user_id, robot, place_kind, place_id, ip, seen_at) " +
    "VALUES (?1, NULL, ?2, ?3, ?4, ?5, ?6) ON CONFLICT (visitor_key) DO NOTHING",
  prune:
    "DELETE FROM online_visitors WHERE id IN (SELECT id FROM online_visitors WHERE seen_at < ?1 ORDER BY seen_at LIMIT ?2)",
};

type Bound = string | number | null;
const statement = (ctx: Ctx, key: string, text: string) =>
  prepared(ctx, `members.online${key}`, () => ctx.sqlite.prepare<never, Bound[]>(text));

/** Writes one chunk of notes in one transaction: a member's upsert, a guest's within the cap. */
function writeChunk(ctx: Ctx, chunk: [string, Visit][]): void {
  writeTx(ctx, () => {
    const upsert = statement(ctx, "Upsert", onlineVisitSql.upsert);
    const touch = statement(ctx, "GuestTouch", onlineVisitSql.guestTouch);
    const insert = statement(ctx, "GuestInsert", onlineVisitSql.guestInsert);
    const stored = prepared(ctx, "members.onlineGuestCount", () =>
      ctx.sqlite.prepare<{ n: number }, []>(onlineVisitSql.guestCount),
    ).get()!.n;
    let room = MAX_STORED_GUESTS - stored;
    for (const [key, visit] of chunk) {
      const { kind, id } = visit.place;
      if (visit.userId !== null) {
        upsert.run(key, visit.userId, null, kind, id, null, visit.at);
        continue;
      }
      const values = [key, visit.robot, kind, id, visit.ip, visit.at];
      if (touch.run(...values).changes > 0 || room <= 0) continue;
      room -= insert.run(...values).changes;
    }
  });
}

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Writes the noted page views, `FLUSH_CHUNK` to a transaction, each holding checkpoints so a
 * commit never meets one, and yields to the event loop between them, so requests (and the
 * checkpointer) run while a large flush is in progress. What a failed chunk and the ones after
 * it held is noted again for the next flush.
 */
export async function flushVisits(ctx: Ctx): Promise<number> {
  const state = pending.get(ctx);
  if (!state?.visits.size) return 0;
  const batch = [...state.visits];
  state.visits.clear();
  state.guests = 0;
  let written = 0;
  try {
    while (written < batch.length) {
      if (written > 0) await yieldToEventLoop();
      const chunk = batch.slice(written, written + FLUSH_CHUNK);
      const release = holdCheckpoints(ctx);
      try {
        writeChunk(ctx, chunk);
      } finally {
        release();
      }
      written += chunk.length;
    }
  } catch (error) {
    for (const [key, visit] of batch.slice(written))
      if (!state.visits.has(key)) {
        state.visits.set(key, visit);
        if (visit.userId === null) state.guests += 1;
      }
    throw error;
  }
  return batch.length;
}

/**
 * Deletes visitors unseen for `VISIT_KEEP_MS`, oldest first, `PRUNE_CHUNK` rows per transaction,
 * holding checkpoints only around each one and pacing the write-ahead log between them.
 */
export async function pruneOnlineVisitors(ctx: Ctx): Promise<number> {
  const prune = prepared(ctx, "members.onlinePrune", () =>
    ctx.sqlite.prepare<never, [number, number]>(onlineVisitSql.prune),
  );
  let deleted = 0;
  while (true) {
    await paceWal(ctx);
    const release = holdCheckpoints(ctx);
    let changes: number;
    try {
      changes = writeTx(ctx, () => prune.run(ctx.now() - VISIT_KEEP_MS, PRUNE_CHUNK).changes);
    } finally {
      release();
    }
    deleted += changes;
    if (changes < PRUNE_CHUNK) return deleted;
    await yieldToEventLoop();
  }
}
