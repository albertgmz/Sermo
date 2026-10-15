import { type Ctx, prepared } from "../../context";
import type { FeatureKind } from "../../db/schema";

/** How long a paid promotion lasts. */
export const PAID_FEATURE_MS = 24 * 3_600_000;

export type FeatureRow = {
  id: number;
  thread_id: number;
  kind: FeatureKind;
  user_id: number;
  started_at: number;
  ends_at: number | null;
};

/*
 * Thread features (staff picks and paid promotions). A feature counts while its `ends_at` is null
 * (a staff pick) or after `now`: every read passes the time, so an expired promotion drops out by
 * itself and no job is needed for correctness. Writers call these inside their own write
 * transaction; none of them checks a permission.
 */
export const featureSql = {
  /** Every feature that counts, through `thread_features_end` (an OR over one index). */
  active:
    "SELECT id, thread_id, kind, user_id, started_at, ends_at FROM thread_features WHERE ends_at IS NULL OR ends_at > ?1",
  /** The features of some threads that count, through `thread_features_thread`. */
  forThreads:
    "SELECT f.id, f.thread_id, f.kind, f.user_id, f.started_at, f.ends_at FROM json_each(?1) AS j CROSS JOIN thread_features f ON f.thread_id = j.value WHERE f.ends_at IS NULL OR f.ends_at > ?2",
  insert:
    "INSERT INTO thread_features (thread_id, kind, user_id, started_at, ends_at) VALUES (?1, ?2, ?3, ?4, ?5)",
  endStaff:
    "UPDATE thread_features SET ends_at = ?2 WHERE thread_id = ?1 AND kind = 'staff' AND ends_at IS NULL",
  /** Cleanup: ended features are old rows nobody reads (the moderator log keeps the record). */
  purge:
    "DELETE FROM thread_features WHERE id IN (SELECT id FROM thread_features WHERE ends_at < ?1 LIMIT ?2)",
};

/** Newest feature first. */
const newestFirst = (a: FeatureRow, b: FeatureRow) => b.started_at - a.started_at || b.id - a.id;

/** The features that count at `now`, newest first. One indexed read of what is active. */
export function activeFeatures(ctx: Ctx, now: number): FeatureRow[] {
  return prepared(ctx, "forums.featuresActive", () =>
    ctx.sqlite.prepare<FeatureRow, [number]>(featureSql.active),
  )
    .all(now)
    .sort(newestFirst);
}

/**
 * Why each thread of `rows` is featured: one entry per thread, in the order the threads first
 * appear. A thread with a staff pick and a paid promotion says `staff`.
 */
export function kindsOf(rows: FeatureRow[]): Map<number, FeatureKind> {
  const kinds = new Map<number, FeatureKind>();
  for (const row of rows)
    if (row.kind === "staff" || !kinds.has(row.thread_id)) kinds.set(row.thread_id, row.kind);
  return kinds;
}

/** Why each of these threads is featured at `now`; threads that are not are absent. */
export function featureKinds(ctx: Ctx, threadIds: number[], now: number): Map<number, FeatureKind> {
  if (threadIds.length === 0) return new Map();
  return kindsOf(
    prepared(ctx, "forums.featuresFor", () =>
      ctx.sqlite.prepare<FeatureRow, [string, number]>(featureSql.forThreads),
    ).all(JSON.stringify([...new Set(threadIds)]), now),
  );
}

/** Starts a feature. `endsAt` is null for a staff pick. */
export function addFeature(
  ctx: Ctx,
  feature: {
    threadId: number;
    kind: FeatureKind;
    userId: number;
    now: number;
    endsAt: number | null;
  },
): void {
  prepared(ctx, "forums.featureInsert", () =>
    ctx.sqlite.prepare<unknown, [number, string, number, number, number | null]>(featureSql.insert),
  ).run(feature.threadId, feature.kind, feature.userId, feature.now, feature.endsAt);
}

/** Ends the staff pick of a thread now. False when there is none. */
export function endStaffFeature(ctx: Ctx, threadId: number, now: number): boolean {
  return (
    prepared(ctx, "forums.featureEndStaff", () =>
      ctx.sqlite.prepare<unknown, [number, number]>(featureSql.endStaff),
    ).run(threadId, now).changes > 0
  );
}

/** Deletes up to `limit` features that ended before `before`; returns how many. */
export function purgeEndedFeatures(ctx: Ctx, before: number, limit: number): number {
  return prepared(ctx, "forums.featurePurge", () =>
    ctx.sqlite.prepare<unknown, [number, number]>(featureSql.purge),
  ).run(before, limit).changes;
}
