import * as z from "zod";
import { type Ctx, prepared } from "../../context";
import { threadsRanked } from "../../contracts/feed";
import { writeTx } from "../../db/tx";
import { implement } from "../../operation";
import { getNodeTree } from "../../permissions";
import {
  readGates,
  type ThreadRow,
  threadColumns,
  threadRowsByIds,
  threadValuesFor,
} from "../forums";
import { purgeEndedFeatures } from "../forums/features";
import { enqueueJob, registerJobHandler } from "../jobs/queue";
import { feedNodes } from "./filter";
import { ignoredAmong, visibleNodes } from "./viewer";

const DAY = 86_400_000;
/** Ended thread features are kept this long, then deleted by the rankings job. */
const FEATURE_KEEP_DAYS = 30;
/** Ended thread features deleted per run. */
const FEATURE_PURGE_BATCH = 500;
/** Threads count for the "most" rankings while their last post is this recent. */
const RANKING_WINDOW_DAYS = 30;
/**
 * Rows each thread ranking keeps per forum. A reader asks for 20 at most, but filters after
 * reading (threads deleted, hidden or moved since the refresh), so the job stores twice that.
 */
const THREAD_RANKING_STORED = 40;
/** The most threads the hot feed shows. */
export const FEED_HOT_SIZE = 50;
/**
 * The most featured threads the hot feed pins above the ranked ones, newest feature first. Staff
 * picks do not end by themselves, so without a cap old picks would fill Hot and push the busy
 * threads out. Features beyond it still show on the home page and carry their mark when they rank.
 */
export const FEED_HOT_PINNED = 10;
/** Threads the hot list keeps per forum: twice what a feed shows, for the same reason. */
const FEED_HOT_STORED = 100;

/*
 * The hot score of a thread: points / (age_hours + HOT_AGE_OFFSET_HOURS) ^ HOT_GRAVITY, where the
 * points are the thread's replies, the reactions on its opening post and its views, and the age is
 * counted from the thread's creation. A thread under the activity floor scores nothing.
 */
/** Points a reply is worth. */
export const HOT_REPLY_POINTS = 4;
/** Points a reaction on the opening post is worth. */
export const HOT_REACTION_POINTS = 3;
/** Points a view is worth: one point per ten views, so reading alone cannot outweigh talking. */
export const HOT_VIEW_POINTS = 0.1;
/**
 * How fast the score falls with age. A forum moves slower than a news feed, so this is gentle:
 * the same points score about 1/14 as much at a day old as at an hour old, and 1/128 at a week.
 */
export const HOT_GRAVITY = 1.2;
/** Added to the age so a thread's first minutes do not divide by almost nothing. */
export const HOT_AGE_OFFSET_HOURS = 2;
/** A thread is not hot with fewer replies than this ... */
export const HOT_MIN_REPLIES = 3;
/** ... unless its opening post has at least this many reactions. */
export const HOT_MIN_REACTIONS = 3;
/** The rankings table keeps integers: the score is stored multiplied by this. */
export const HOT_SCORE_SCALE = 1_000_000;
const HOUR = 3_600_000;
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
    "SELECT id, node_id, reply_count, view_count, first_post_id, created_at, last_post_at FROM threads WHERE state = 'visible' AND last_post_at >= ?1 AND (last_post_at, id) < (?2, ?3) ORDER BY last_post_at DESC, id DESC LIMIT ?4",
  reactionCounts:
    "SELECT id, reaction_counts FROM posts WHERE id IN (SELECT value FROM json_each(?1))",
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

/**
 * The hot score of a thread, multiplied by `HOT_SCORE_SCALE` and rounded: 0 when the thread is
 * under the activity floor (fewer than `HOT_MIN_REPLIES` replies and fewer than
 * `HOT_MIN_REACTIONS` reactions on its opening post), and so never listed.
 */
export function hotScore(thread: {
  replies: number;
  reactions: number;
  views: number;
  createdAt: number;
  now: number;
}): number {
  if (thread.replies < HOT_MIN_REPLIES && thread.reactions < HOT_MIN_REACTIONS) return 0;
  const points =
    thread.replies * HOT_REPLY_POINTS +
    thread.reactions * HOT_REACTION_POINTS +
    thread.views * HOT_VIEW_POINTS;
  const ageHours = Math.max(0, thread.now - thread.createdAt) / HOUR;
  return Math.round((points / (ageHours + HOT_AGE_OFFSET_HOURS) ** HOT_GRAVITY) * HOT_SCORE_SCALE);
}

type Kind = "mostReplied" | "mostViewed" | "mostReacted" | "hot";

/**
 * Recomputes the rankings in slices: each slice reads a bounded index range, so the event loop
 * gets control between slices when the job drives it (`yield` marks the boundaries). Each forum
 * keeps its own best entries, grouped in memory. The only writes are one short transaction per
 * kind at the end. This job and nothing else scans threads by activity or totals reaction
 * counts; readers only read `rankings`. The hot list is scored from the same slices as the
 * other thread rankings (target = thread id, score = `hotScore`).
 */
function* recompute(ctx: Ctx): Generator<void, void, void> {
  const now = ctx.now();
  const since = now - RANKING_WINDOW_DAYS * DAY;
  const results: Record<Kind, PerForum> = {
    mostReplied: new PerForum(THREAD_RANKING_STORED),
    mostViewed: new PerForum(THREAD_RANKING_STORED),
    mostReacted: new PerForum(THREAD_RANKING_STORED),
    hot: new PerForum(FEED_HOT_STORED),
  };
  const threadSlice = prepared(ctx, "feed.rankActive", () =>
    ctx.sqlite.prepare<
      {
        id: number;
        node_id: number;
        reply_count: number;
        view_count: number;
        first_post_id: number | null;
        created_at: number;
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
    results.hot.addAll(
      rows.flatMap((row) => {
        const score = hotScore({
          replies: row.reply_count,
          reactions: firstPosts.get(row.first_post_id ?? 0) ?? 0,
          views: row.view_count,
          createdAt: row.created_at,
          now,
        });
        return score > 0 ? [{ nodeId: row.node_id, id: row.id, score }] : [];
      }),
    );
    lastAt = rows.at(-1)!.last_post_at;
    lastId = rows.at(-1)!.id;
    yield;
    if (rows.length < SLICE) break;
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
  // Thread features that ended long ago are rows nobody reads: one bounded delete each run.
  writeTx(ctx, () => purgeEndedFeatures(ctx, now - FEATURE_KEEP_DAYS * DAY, FEATURE_PURGE_BATCH));
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
 * All stored entries of a kind across `nodes`, best first: one indexed read of the rows of those
 * forums, merged by score (ties: lower position, then lower target id). At most the number of
 * forums times what the job keeps per forum (40 or 100) rows. Each forum's rows are its best in
 * order, so the merge is exact for what survives the caller's filtering.
 */
export function storedRanking(ctx: Ctx, kind: Kind, nodes: Iterable<number>): StoredRow[] {
  const ids = [...nodes];
  if (ids.length === 0) return [];
  return prepared(ctx, "feed.rankedStored", () =>
    ctx.sqlite.prepare<StoredRow, [string, string]>(rankingSql.stored),
  )
    .all(kind, JSON.stringify(ids))
    .sort((a, b) => b.score - a.score || a.position - b.position || a.target_id - b.target_id);
}

/**
 * The first `want` entries of `ranked`, in order, that survive the reader's filters. `load`
 * receives a chunk of stored rows (one batched read of their targets) and returns the survivors
 * in chunk order. Chunks of twice `want` are loaded until enough survive or the stored rows run
 * out, so the targets read never exceed the stored rows (and in the usual case, where almost
 * everything survives, they are `2 * want` at most).
 */
export function firstSurvivors<T, Row = StoredRow>(
  ranked: Row[],
  want: number,
  load: (chunk: Row[]) => T[],
): T[] {
  const size = Math.max(want * 2, 1);
  const out: T[] = [];
  for (let from = 0; from < ranked.length && out.length < want; from += size)
    out.push(...load(ranked.slice(from, from + size)));
  return out.slice(0, want);
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
  // Forums whose other members' threads are closed to the viewer take no part in a ranking.
  const gates = readGates(ctx, actor);
  const visible = new Set([...visibleNodes(ctx, actor)].filter((id) => gates.opensOthers(id)));
  // The home page's side blocks ask for what the feed shows: the site's and the member's hidden forums go.
  const nodes = input.feed ? feedNodes(ctx, actor, visible) : visible;
  if (input.by === "latestPosts" || input.by === "latestThreads")
    return {
      items: threadValuesFor(ctx, actor, newestThreads(ctx, nodes, input.by, input.limit)),
    };
  const kind = z.enum(["mostReplied", "mostReacted", "mostViewed"]).parse(input.by);
  const rows = firstSurvivors(storedRanking(ctx, kind, nodes), input.limit, (chunk) => {
    const byId = new Map(
      threadRowsByIds(
        ctx,
        chunk.map((row) => row.target_id),
      ).map((row) => [row.id, row]),
    );
    const ignored = ignoredAmong(
      ctx,
      actor,
      [...byId.values()].map((thread) => thread.user_id),
    );
    return chunk.flatMap((row) => {
      const thread = byId.get(row.target_id);
      return thread &&
        thread.state === "visible" &&
        nodes.has(thread.node_id) &&
        !ignored.has(thread.user_id)
        ? [thread]
        : [];
    });
  });
  return { items: threadValuesFor(ctx, actor, rows) };
});
