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
/** Notes kept between flushes; past this a new visitor waits for the next flush. */
export const MAX_PENDING_VISITS = 10_000;
/** Rows the prune deletes per transaction. */
export const PRUNE_CHUNK = 500;

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

const pending = new WeakMap<Ctx, Map<string, Visit>>();

function pendingOf(ctx: Ctx): Map<string, Visit> {
  let map = pending.get(ctx);
  if (!map) {
    map = new Map();
    pending.set(ctx, map);
  }
  return map;
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
  const map = pendingOf(ctx);
  const userAgent = visit.userAgent ?? "";
  const ip = visit.ip && visit.ip !== "unknown" ? visit.ip : null;
  const key =
    visit.userId === null ? guestKey(ctx, ip ?? "", userAgent) : memberVisitKey(visit.userId);
  const known = map.get(key);
  if (!known && map.size >= MAX_PENDING_VISITS) return;
  map.set(key, {
    userId: visit.userId,
    robot: known ? known.robot : visit.userId === null ? robotOf(userAgent) : null,
    place: parsePlace(visit.place),
    ip: visit.userId === null ? ip : null,
    at: ctx.now(),
  });
}

/** The notes not written yet, by visitor key. */
export function pendingVisits(ctx: Ctx): ReadonlyMap<string, Visit> {
  return pending.get(ctx) ?? new Map();
}

export const onlineVisitSql = {
  // From `users` for a member, so a member deleted since the note leaves no row and no error.
  upsert:
    "INSERT INTO online_visitors (visitor_key, user_id, robot, place_kind, place_id, ip, seen_at) " +
    "SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7 WHERE ?2 IS NULL OR EXISTS (SELECT 1 FROM users WHERE id = ?2) " +
    "ON CONFLICT (visitor_key) DO UPDATE SET robot = excluded.robot, place_kind = excluded.place_kind, " +
    "place_id = excluded.place_id, ip = excluded.ip, seen_at = excluded.seen_at " +
    "WHERE excluded.seen_at >= online_visitors.seen_at",
  prune:
    "DELETE FROM online_visitors WHERE id IN (SELECT id FROM online_visitors WHERE seen_at < ?1 ORDER BY seen_at LIMIT ?2)",
};

/** Writes the noted page views in one short transaction: one upsert per visitor. */
export function flushVisits(ctx: Ctx): number {
  const map = pending.get(ctx);
  if (!map?.size) return 0;
  const batch = [...map];
  map.clear();
  try {
    writeTx(ctx, () => {
      const upsert = prepared(ctx, "members.onlineUpsert", () =>
        ctx.sqlite.prepare(onlineVisitSql.upsert),
      );
      for (const [key, visit] of batch)
        upsert.run(
          key,
          visit.userId,
          visit.robot,
          visit.place.kind,
          visit.place.id,
          visit.ip,
          visit.at,
        );
    });
  } catch (error) {
    for (const [key, visit] of batch) if (!map.has(key)) map.set(key, visit);
    throw error;
  }
  return batch.length;
}

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

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
