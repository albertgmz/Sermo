import * as z from "zod";
import { type Ctx, prepared } from "../../context";
import { threadsRanked } from "../../contracts/feed";
import { writeTx } from "../../db/tx";
import { implement } from "../../operation";
import { type ThreadRow, threadColumns, threadValuesFor } from "../forums";
import { registerJobHandler } from "../jobs/queue";
import { scanKeyset } from "./scan";
import { visibleNodes } from "./viewer";

const DAY = 86_400_000;
/** Threads count for the "most" rankings while their last post is this recent. */
export const RANKING_WINDOW_DAYS = 30;
/** Rows each thread ranking keeps. */
export const THREAD_RANKING_SIZE = 100;
/** The feed's top list: the most reacted-to posts of the last seven days. */
export const FEED_TOP_DAYS = 7;
export const FEED_TOP_SIZE = 200;
/** Rows one slice of the recomputation reads before it yields to the event loop. */
const SLICE = 2000;

export const rankingSql = {
  latestPosts: `SELECT ${threadColumns} FROM threads WHERE state = 'visible' AND (last_post_at, id) < (?1, ?2) ORDER BY last_post_at DESC, id DESC LIMIT ?3`,
  latestThreads: `SELECT ${threadColumns} FROM threads WHERE state = 'visible' AND id < ?1 ORDER BY id DESC LIMIT ?2`,
  stored: `SELECT ${threadColumns
    .split(", ")
    .map((c) => `t.${c}`)
    .join(
      ", ",
    )} FROM rankings r JOIN threads t ON t.id = r.target_id WHERE r.kind = ?1 ORDER BY r.position`,
  /** Recomputation: one slice of the recently active visible threads, newest activity first. */
  activeThreads:
    "SELECT id, reply_count, view_count, first_post_id, last_post_at FROM threads WHERE state = 'visible' AND last_post_at >= ?1 AND (last_post_at, id) < (?2, ?3) ORDER BY last_post_at DESC, id DESC LIMIT ?4",
  reactionCounts:
    "SELECT id, reaction_counts FROM posts WHERE id IN (SELECT value FROM json_each(?1))",
  /** The first post at or after an id: the probe of the search for the oldest post of the week. */
  postAtOrAfter: "SELECT id, created_at FROM posts WHERE id >= ?1 ORDER BY id LIMIT 1",
  lastPostId: "SELECT max(id) AS id FROM posts",
  /** One slice of the posts of the week, by id range. */
  recentPosts:
    "SELECT id, thread_id, reaction_counts FROM posts WHERE id >= ?1 AND id < ?2 AND state = 'visible' AND created_at >= ?3",
  visibleThreads:
    "SELECT id FROM threads WHERE state = 'visible' AND id IN (SELECT value FROM json_each(?1))",
  replace: "DELETE FROM rankings WHERE kind = ?1",
  insert: "INSERT INTO rankings (kind, position, target_id, score) VALUES (?1, ?2, ?3, ?4)",
};

type Scored = { id: number; score: number };
const better = (a: Scored, b: Scored) => b.score - a.score || b.id - a.id;

/** Keeps the best `size` entries, best first. */
function keepBest(list: Scored[], add: Scored[], size: number): Scored[] {
  return [...list, ...add].sort(better).slice(0, size);
}

/** The total of a post's `reaction_counts` JSON ({"<typeId>": n}). */
export function reactionTotal(json: string): number {
  let total = 0;
  for (const count of Object.values(JSON.parse(json) as Record<string, number>)) total += count;
  return total;
}

type Kind = "mostReplied" | "mostViewed" | "mostReacted" | "feedTop";

/**
 * Recomputes the rankings in slices: each slice reads a bounded index range, so the event loop
 * gets control between slices when the job drives it (`yield` marks the boundaries). The only
 * writes are one short transaction per kind at the end. This job and nothing else scans threads
 * by activity or totals reaction counts; readers only read `rankings`.
 */
function* recompute(ctx: Ctx): Generator<void, void, void> {
  const now = ctx.now();
  const since = now - RANKING_WINDOW_DAYS * DAY;
  const results: Record<Kind, Scored[]> = {
    mostReplied: [],
    mostViewed: [],
    mostReacted: [],
    feedTop: [],
  };
  const threadSlice = prepared(ctx, "feed.rankActive", () =>
    ctx.sqlite.prepare<
      {
        id: number;
        reply_count: number;
        view_count: number;
        first_post_id: number | null;
        last_post_at: number;
      },
      [number, number, number, number]
    >(rankingSql.activeThreads),
  );
  const counts = prepared(ctx, "feed.rankReactions", () =>
    ctx.sqlite.prepare<{ id: number; reaction_counts: string }, [string]>(
      rankingSql.reactionCounts,
    ),
  );
  let lastAt = Number.MAX_SAFE_INTEGER;
  let lastId = Number.MAX_SAFE_INTEGER;
  while (true) {
    const rows = threadSlice.all(since, lastAt, lastId, SLICE);
    if (rows.length === 0) break;
    const firstPosts = new Map(
      counts
        .all(JSON.stringify(rows.flatMap((row) => (row.first_post_id ? [row.first_post_id] : []))))
        .map((row) => [row.id, reactionTotal(row.reaction_counts)] as const),
    );
    const size = THREAD_RANKING_SIZE;
    results.mostReplied = keepBest(
      results.mostReplied,
      rows.map((row) => ({ id: row.id, score: row.reply_count })),
      size,
    );
    results.mostViewed = keepBest(
      results.mostViewed,
      rows.map((row) => ({ id: row.id, score: row.view_count })),
      size,
    );
    results.mostReacted = keepBest(
      results.mostReacted,
      rows.map((row) => ({ id: row.id, score: firstPosts.get(row.first_post_id ?? 0) ?? 0 })),
      size,
    );
    lastAt = rows.at(-1)!.last_post_at;
    lastId = rows.at(-1)!.id;
    yield;
    if (rows.length < SLICE) break;
  }

  // The posts of the last week. Post ids grow with time, so the week is the id range from the
  // oldest post created inside it: found by bisecting on the primary key (about 20 probes),
  // then read in id slices. A post created in the week with a lower id than an older post
  // (an import) would be missed; posts written by the application never are.
  const weekStart = now - FEED_TOP_DAYS * DAY;
  const probe = prepared(ctx, "feed.rankProbe", () =>
    ctx.sqlite.prepare<{ id: number; created_at: number }, [number]>(rankingSql.postAtOrAfter),
  );
  const top = ctx.sqlite.prepare<{ id: number | null }, []>(rankingSql.lastPostId).get()?.id ?? 0;
  let low = 1;
  let high = top + 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const found = probe.get(middle);
    if (found && found.created_at >= weekStart) high = middle;
    else low = found ? Math.min(found.id + 1, high) : high;
  }
  const slicePosts = prepared(ctx, "feed.rankRecent", () =>
    ctx.sqlite.prepare<
      { id: number; thread_id: number; reaction_counts: string },
      [number, number, number]
    >(rankingSql.recentPosts),
  );
  const visibleThreads = prepared(ctx, "feed.rankVisibleThreads", () =>
    ctx.sqlite.prepare<{ id: number }, [string]>(rankingSql.visibleThreads),
  );
  for (let from = low; from <= top; from += SLICE) {
    const positive = slicePosts
      .all(from, from + SLICE, weekStart)
      .map((row) => ({
        id: row.id,
        thread_id: row.thread_id,
        score: reactionTotal(row.reaction_counts),
      }))
      .filter((row) => row.score > 0);
    if (positive.length > 0) {
      const live = new Set(
        visibleThreads
          .all(JSON.stringify([...new Set(positive.map((row) => row.thread_id))]))
          .map((row) => row.id),
      );
      results.feedTop = keepBest(
        results.feedTop,
        positive.filter((row) => live.has(row.thread_id)),
        FEED_TOP_SIZE,
      );
    }
    yield;
  }

  const clear = prepared(ctx, "feed.rankClear", () =>
    ctx.sqlite.prepare<unknown, [string]>(rankingSql.replace),
  );
  const insert = prepared(ctx, "feed.rankInsert", () =>
    ctx.sqlite.prepare<unknown, [string, number, number, number]>(rankingSql.insert),
  );
  for (const kind of Object.keys(results) as Kind[]) {
    writeTx(ctx, () => {
      clear.run(kind);
      for (const [index, entry] of results[kind].entries())
        insert.run(kind, index, entry.id, entry.score);
    });
    yield;
  }
}

/** Recomputes every ranking now, without yielding. For tests and administration tools. */
export function refreshRankings(ctx: Ctx): void {
  const run = recompute(ctx);
  while (!run.next().done);
}

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

export function registerRankingJobs(ctx: Ctx): void {
  registerJobHandler(ctx, "rankings.refresh", async (context) => {
    const run = recompute(context);
    while (!run.next().done) await yieldToEventLoop();
  });
}

const BATCH = 40;
/** The most threads one `latestPosts` or `latestThreads` request examines. */
export const RANKED_EXAMINE_CAP = 400;

export const threadsRankedOp = implement(threadsRanked, (ctx, actor, input) => {
  const nodes = visibleNodes(ctx, actor);
  const accept = (rows: ThreadRow[]) => new Set(rows.filter((row) => nodes.has(row.node_id)));
  let rows: ThreadRow[];
  if (input.by === "latestPosts") {
    const query = prepared(ctx, "feed.latestPosts", () =>
      ctx.sqlite.prepare<ThreadRow, [number, number, number]>(rankingSql.latestPosts),
    );
    rows = scanKeyset<ThreadRow, [number, number]>({
      before: null,
      limit: input.limit,
      batch: BATCH,
      cap: RANKED_EXAMINE_CAP,
      fetch: (before, count) =>
        query.all(
          before?.[0] ?? Number.MAX_SAFE_INTEGER,
          before?.[1] ?? Number.MAX_SAFE_INTEGER,
          count,
        ),
      keyOf: (row) => [row.last_post_at, row.id],
      accept,
    }).items;
  } else if (input.by === "latestThreads") {
    const query = prepared(ctx, "feed.latestThreads", () =>
      ctx.sqlite.prepare<ThreadRow, [number, number]>(rankingSql.latestThreads),
    );
    rows = scanKeyset<ThreadRow, number>({
      before: null,
      limit: input.limit,
      batch: BATCH,
      cap: RANKED_EXAMINE_CAP,
      fetch: (before, count) => query.all(before ?? Number.MAX_SAFE_INTEGER, count),
      keyOf: (row) => row.id,
      accept,
    }).items;
  } else {
    const kind = z.enum(["mostReplied", "mostReacted", "mostViewed"]).parse(input.by);
    rows = prepared(ctx, "feed.rankedStored", () =>
      ctx.sqlite.prepare<ThreadRow, [string]>(rankingSql.stored),
    )
      .all(kind)
      .filter((row) => row.state === "visible" && nodes.has(row.node_id))
      .slice(0, input.limit);
  }
  return { items: threadValuesFor(ctx, actor, rows) };
});
