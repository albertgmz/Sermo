import * as z from "zod";
import { type Ctx, prepared } from "../../context";
import { threadsRanked } from "../../contracts/feed";
import { writeTx } from "../../db/tx";
import { implement } from "../../operation";
import { getNodeTree } from "../../permissions";
import { type ThreadRow, threadColumns, threadRowsByIds, threadValuesFor } from "../forums";
import { enqueueJob, registerJobHandler } from "../jobs/queue";
import { visibleNodes } from "./viewer";

const DAY = 86_400_000;
/** Threads count for the "most" rankings while their last post is this recent. */
export const RANKING_WINDOW_DAYS = 30;
/** Rows each thread ranking keeps per forum: the most `threads.ranked` ever asks for. */
export const THREAD_RANKING_SIZE = 20;
/** The feed's top list: the most reacted-to posts of the last seven days. */
export const FEED_TOP_DAYS = 7;
/** Posts the top list keeps per forum, and the most a feed shows. */
export const FEED_TOP_SIZE = 50;
/** Rows one slice of the recomputation reads before it yields to the event loop. */
const SLICE = 2000;

const threadColumnsOf = (alias: string) =>
  threadColumns
    .split(", ")
    .map((c) => `${alias}.${c}`)
    .join(", ");

export const rankingSql = {
  latestPosts: `SELECT ${threadColumns} FROM threads WHERE state = 'visible' AND (last_post_at, id) < (?1, ?2) ORDER BY last_post_at DESC, id DESC LIMIT ?3`,
  latestThreads: `SELECT ${threadColumns} FROM threads WHERE state = 'visible' AND id < ?1 ORDER BY id DESC LIMIT ?2`,
  /** The newest `?2` threads by activity of each forum in `?1`, through `threads_node_feed`. */
  latestPostsIn: `SELECT ${threadColumnsOf("t")} FROM json_each(?1) AS j CROSS JOIN threads t WHERE t.id IN (SELECT t2.id FROM threads t2 WHERE t2.node_id = j.value AND t2.state = 'visible' ORDER BY t2.last_post_at DESC, t2.id DESC LIMIT ?2)`,
  /** The newest `?2` threads by creation of each forum in `?1`, through `threads_node_state_id`. */
  latestThreadsIn: `SELECT ${threadColumnsOf("t")} FROM json_each(?1) AS j CROSS JOIN threads t WHERE t.id IN (SELECT t2.id FROM threads t2 WHERE t2.node_id = j.value AND t2.state = 'visible' ORDER BY t2.id DESC LIMIT ?2)`,
  /** The stored rows of a kind for some forums: one index search per forum. */
  stored:
    "SELECT node_id, position, target_id, score FROM rankings WHERE kind = ?1 AND node_id IN (SELECT value FROM json_each(?2))",
  /** Recomputation: one slice of the recently active visible threads, newest activity first. */
  activeThreads:
    "SELECT id, node_id, reply_count, view_count, first_post_id, last_post_at FROM threads WHERE state = 'visible' AND last_post_at >= ?1 AND (last_post_at, id) < (?2, ?3) ORDER BY last_post_at DESC, id DESC LIMIT ?4",
  reactionCounts:
    "SELECT id, reaction_counts FROM posts WHERE id IN (SELECT value FROM json_each(?1))",
  /** The first post at or after an id: the probe of the search for the oldest post of the week. */
  postAtOrAfter: "SELECT id, created_at FROM posts WHERE id >= ?1 ORDER BY id LIMIT 1",
  lastPostId: "SELECT max(id) AS id FROM posts",
  /** One slice of the posts of the week, by id range. */
  recentPosts:
    "SELECT id, thread_id, reaction_counts FROM posts WHERE id >= ?1 AND id < ?2 AND state = 'visible' AND created_at >= ?3",
  visibleThreads:
    "SELECT id, node_id FROM threads WHERE state = 'visible' AND id IN (SELECT value FROM json_each(?1))",
  replace: "DELETE FROM rankings WHERE kind = ?1",
  insert:
    "INSERT INTO rankings (kind, node_id, position, target_id, score) VALUES (?1, ?2, ?3, ?4, ?5)",
};

type Scored = { id: number; score: number };
const better = (a: Scored, b: Scored) => b.score - a.score || b.id - a.id;

/** Keeps the best `size` entries, best first. */
function keepBest(list: Scored[], add: Scored[], size: number): Scored[] {
  return [...list, ...add].sort(better).slice(0, size);
}

/** The best entries of each forum, kept while the job walks its slices. */
class PerForum {
  readonly byNode = new Map<number, Scored[]>();
  constructor(private readonly size: number) {}
  addAll(rows: { nodeId: number; id: number; score: number }[]): void {
    const grouped = new Map<number, Scored[]>();
    for (const row of rows) {
      const list = grouped.get(row.nodeId) ?? [];
      list.push({ id: row.id, score: row.score });
      grouped.set(row.nodeId, list);
    }
    for (const [nodeId, entries] of grouped)
      this.byNode.set(nodeId, keepBest(this.byNode.get(nodeId) ?? [], entries, this.size));
  }
}

/** The total of a post's `reaction_counts` JSON ({"<typeId>": n}); a malformed document counts 0. */
export function reactionTotal(json: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return 0;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return 0;
  let total = 0;
  for (const count of Object.values(parsed)) if (typeof count === "number") total += count;
  return total;
}

export type Kind = "mostReplied" | "mostViewed" | "mostReacted" | "feedTop";

/**
 * Recomputes the rankings in slices: each slice reads a bounded index range, so the event loop
 * gets control between slices when the job drives it (`yield` marks the boundaries). Each forum
 * keeps its own best entries, grouped in memory. The only writes are one short transaction per
 * kind at the end. This job and nothing else scans threads by activity or totals reaction
 * counts; readers only read `rankings`.
 */
function* recompute(ctx: Ctx): Generator<void, void, void> {
  const now = ctx.now();
  const since = now - RANKING_WINDOW_DAYS * DAY;
  const results: Record<Kind, PerForum> = {
    mostReplied: new PerForum(THREAD_RANKING_SIZE),
    mostViewed: new PerForum(THREAD_RANKING_SIZE),
    mostReacted: new PerForum(THREAD_RANKING_SIZE),
    feedTop: new PerForum(FEED_TOP_SIZE),
  };
  const threadSlice = prepared(ctx, "feed.rankActive", () =>
    ctx.sqlite.prepare<
      {
        id: number;
        node_id: number;
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
    results.mostReplied.addAll(
      rows.map((row) => ({ nodeId: row.node_id, id: row.id, score: row.reply_count })),
    );
    results.mostViewed.addAll(
      rows.map((row) => ({ nodeId: row.node_id, id: row.id, score: row.view_count })),
    );
    results.mostReacted.addAll(
      rows.map((row) => ({
        nodeId: row.node_id,
        id: row.id,
        score: firstPosts.get(row.first_post_id ?? 0) ?? 0,
      })),
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
    ctx.sqlite.prepare<{ id: number; node_id: number }, [string]>(rankingSql.visibleThreads),
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
      const live = new Map(
        visibleThreads
          .all(JSON.stringify([...new Set(positive.map((row) => row.thread_id))]))
          .map((row) => [row.id, row.node_id] as const),
      );
      results.feedTop.addAll(
        positive.flatMap((row) => {
          const nodeId = live.get(row.thread_id);
          return nodeId === undefined ? [] : [{ nodeId, id: row.id, score: row.score }];
        }),
      );
    }
    yield;
  }

  const clear = prepared(ctx, "feed.rankClear", () =>
    ctx.sqlite.prepare<unknown, [string]>(rankingSql.replace),
  );
  const insert = prepared(ctx, "feed.rankInsert", () =>
    ctx.sqlite.prepare<unknown, [string, number, number, number, number]>(rankingSql.insert),
  );
  for (const kind of Object.keys(results) as Kind[]) {
    writeTx(ctx, () => {
      clear.run(kind);
      for (const [nodeId, entries] of results[kind].byNode)
        for (const [index, entry] of entries.entries())
          insert.run(kind, nodeId, index, entry.id, entry.score);
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

/**
 * Registers the refresh job and queues one now, so the rankings exist right after a start
 * instead of after the next fifth minute. The unique key keeps a restart loop from piling them up.
 */
export function registerRankingJobs(ctx: Ctx): void {
  registerJobHandler(ctx, "rankings.refresh", async (context) => {
    const run = recompute(context);
    while (!run.next().done) await yieldToEventLoop();
  });
  enqueueJob(ctx, "rankings.refresh", {}, { uniqueKey: "rankings.refresh" });
}

type StoredRow = { node_id: number; position: number; target_id: number; score: number };

/**
 * The best `size` stored entries of a kind across `nodes`, best first: one indexed read of the
 * rows of those forums, merged by score (ties: lower position, then lower target id). Each forum
 * keeps at least as many entries as any reader asks for, so the merge is exact for those forums.
 */
export function storedRanking(
  ctx: Ctx,
  kind: Kind,
  nodes: Iterable<number>,
  size: number,
): StoredRow[] {
  const ids = [...nodes];
  if (ids.length === 0) return [];
  return prepared(ctx, "feed.rankedStored", () =>
    ctx.sqlite.prepare<StoredRow, [string, string]>(rankingSql.stored),
  )
    .all(kind, JSON.stringify(ids))
    .sort((a, b) => b.score - a.score || a.position - b.position || a.target_id - b.target_id)
    .slice(0, size);
}

/**
 * The newest `limit` threads of the forums in `nodes`. When the viewer can open every forum, the
 * global index walk. Otherwise the newest `limit` of each forum through its own index
 * (`threads_node_feed` by activity, `threads_node_state_id` by creation) in one statement over
 * all of them, merged here: no forum can contribute more than `limit`, so the merge is exact. The
 * work is bounded by the number of forums (a forum tree is small) times `limit`, and never by how
 * much newer content the viewer cannot see.
 */
function newestThreads(
  ctx: Ctx,
  nodes: Set<number>,
  by: "latestPosts" | "latestThreads",
  limit: number,
): ThreadRow[] {
  if (nodes.size === getNodeTree(ctx).entries.length) {
    if (by === "latestPosts")
      return prepared(ctx, "feed.latestPosts", () =>
        ctx.sqlite.prepare<ThreadRow, [number, number, number]>(rankingSql.latestPosts),
      ).all(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, limit);
    return prepared(ctx, "feed.latestThreads", () =>
      ctx.sqlite.prepare<ThreadRow, [number, number]>(rankingSql.latestThreads),
    ).all(Number.MAX_SAFE_INTEGER, limit);
  }
  if (nodes.size === 0) return [];
  const rows = prepared(ctx, `feed.${by}In`, () =>
    ctx.sqlite.prepare<ThreadRow, [string, number]>(
      by === "latestPosts" ? rankingSql.latestPostsIn : rankingSql.latestThreadsIn,
    ),
  ).all(JSON.stringify([...nodes]), limit);
  rows.sort(
    by === "latestPosts"
      ? (a, b) => b.last_post_at - a.last_post_at || b.id - a.id
      : (a, b) => b.id - a.id,
  );
  return rows.slice(0, limit);
}

export const threadsRankedOp = implement(threadsRanked, (ctx, actor, input) => {
  const nodes = visibleNodes(ctx, actor);
  if (input.by === "latestPosts" || input.by === "latestThreads")
    return {
      items: threadValuesFor(ctx, actor, newestThreads(ctx, nodes, input.by, input.limit)),
    };
  const kind = z.enum(["mostReplied", "mostReacted", "mostViewed"]).parse(input.by);
  const ranked = storedRanking(ctx, kind, nodes, input.limit);
  const byId = new Map(
    threadRowsByIds(
      ctx,
      ranked.map((row) => row.target_id),
    ).map((row) => [row.id, row]),
  );
  const rows = ranked.flatMap((row) => {
    const thread = byId.get(row.target_id);
    return thread && thread.state === "visible" && nodes.has(thread.node_id) ? [thread] : [];
  });
  return { items: threadValuesFor(ctx, actor, rows) };
});
