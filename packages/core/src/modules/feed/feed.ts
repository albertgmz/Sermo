import * as z from "zod";
import { type Actor, requireAuthenticated } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { type FeedItem, feedList, feedNewCount } from "../../contracts/feed";
import type { FeatureKind } from "../../db/schema";
import { implement, markPublic } from "../../operation";
import { decodeCursor, encodeCursor } from "../../pagination";
import { can } from "../../permissions";
import { iso } from "../../time";
import { readGates, repliableThreads, type ThreadRow, threadRowsByIds } from "../forums";
import { activeFeatures, featureKinds, kindsOf } from "../forums/features";
import {
  latestComments,
  mayViewProfile,
  type ProfilePostRow,
  profileAccessMany,
  profilePostValues,
} from "../profiles";
import { blockedAmong } from "../social/blocks";
import { loadThreads, postsInThreads } from "./authors";
import { type FeedPlan, planFeed } from "./filter";
import { FEED_HOT_PINNED, FEED_HOT_SIZE, firstSurvivors, storedRanking } from "./rankings";
import { SCAN_CAP } from "./scan";
import { unreadIn } from "./unread";
import { followedAmong, followedAuthors, visibleNodes } from "./viewer";

/** Posts examined per source per request, at most. */
const FEED_EXAMINE_CAP = SCAN_CAP;
const MIN_BATCH = 10;

export type PostCandidate = {
  id: number;
  thread_id: number;
  user_id: number;
  state: "visible" | "moderated" | "deleted";
  created_at: number;
};
export type WallCandidate = {
  id: number;
  profile_user_id: number;
  user_id: number;
  state: "visible" | "moderated" | "deleted";
  created_at: number;
};

export const feedSql = {
  wall: "SELECT id, profile_user_id, user_id, state, created_at FROM profile_posts WHERE state = 'visible' AND id < ?1 ORDER BY id DESC LIMIT ?2",
  /**
   * The newest posts of any of the given authors: each author's newest rows by the (user, id)
   * index, merged by the caller. `?3` bounds every author's walk.
   */
  followedPosts:
    "SELECT p.id, p.thread_id, p.user_id, p.state, p.created_at FROM json_each(?1) AS j CROSS JOIN posts p WHERE p.id IN (SELECT p2.id FROM posts p2 WHERE p2.user_id = j.value AND p2.id < ?2 ORDER BY p2.id DESC LIMIT ?3)",
  followedWall:
    "SELECT p.id, p.profile_user_id, p.user_id, p.state, p.created_at FROM json_each(?1) AS j CROSS JOIN profile_posts p WHERE p.id IN (SELECT p2.id FROM profile_posts p2 WHERE p2.user_id = j.value AND p2.id < ?2 ORDER BY p2.id DESC LIMIT ?3)",
  wallRows: "SELECT * FROM profile_posts WHERE id IN (SELECT value FROM json_each(?1))",
  /**
   * The visible posts of a thread older than post `?2`, newest first, by `posts_thread_position`:
   * what `latest` shows of a thread whose newest posts are by members in a block with the viewer.
   */
  olderPosts:
    "SELECT id, user_id FROM posts WHERE thread_id = ?1 AND state = 'visible' AND position < (SELECT position FROM posts WHERE id = ?2) ORDER BY position DESC LIMIT 20",
  hotPosts:
    "SELECT id, thread_id, user_id, state, created_at FROM posts WHERE id IN (SELECT value FROM json_each(?1))",
};

type FeedItemValue = z.infer<typeof FeedItem>;
const cursorPart = z.number().int().nonnegative();
/** Where each side continues: the forum side, then the wall side. */
const cursorSchema = {
  /** `latest` walks threads by activity: (last post time, thread id). */
  latest: z.tuple([cursorPart, cursorPart, cursorPart]),
  following: z.tuple([cursorPart, cursorPart]),
};
type ThreadKey = [lastPostAt: number, threadId: number];

/**
 * One side of the merged stream. A row's `created_at` is the time it is merged by; `Key` is
 * where the walk continues (a row id, or a thread's place by activity).
 */
interface Source<Row extends { created_at: number }, Key> {
  readonly rank: number;
  /** Rows below `before`, newest first, at most `count`; fewer only at the end. */
  fetch(before: Key, count: number): Row[];
  /** The rows the viewer may see. */
  accept(rows: Row[]): Set<Row>;
  /** The place of a row in the walk. */
  keyOf(row: Row): Key;
  /** The bound that takes the row at `key` again and nothing above it. */
  from(key: Key): Key;
  /** The bound that says the walk has nothing more. */
  readonly end: Key;
  /** Exclusive upper bound of the next fetch. */
  before: Key;
  buffer: Row[];
  examined: number;
  exhausted: boolean;
  /** Merge time of the oldest row examined: nothing unexamined is newer. */
  low: number;
}

function source<Row extends { created_at: number }, Key>(
  options: Pick<Source<Row, Key>, "rank" | "fetch" | "accept" | "keyOf" | "from" | "end"> & {
    before: Key;
    disabled?: boolean;
    /** Merge time (epoch ms) a row must exceed: the walk ends at the first row that does not. */
    since?: number;
  },
): Source<Row, Key> {
  const { before, disabled = false, since, ...walk } = options;
  if (since !== undefined) {
    const fetchAll = walk.fetch;
    // Rows come newest first, so what follows the first old row is old too; a short answer also
    // marks the walk exhausted. This assumes `created_at` grows with the walk key (ids, or last
    // activity), which holds for rows written through the API; a row with a backdated time, from
    // an import, ends the walk early and the count comes out low.
    walk.fetch = (from, count) => {
      const rows = fetchAll(from, count);
      const old = rows.findIndex((row) => row.created_at <= since);
      return old < 0 ? rows : rows.slice(0, old);
    };
  }
  const done = disabled || JSON.stringify(before) === JSON.stringify(walk.end);
  return {
    ...walk,
    before,
    buffer: [],
    examined: 0,
    exhausted: done,
    low: done ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
  };
}

/** A walk by row id, newest id first: a cursor of 0 says there is nothing more. */
const byId = {
  keyOf: (row: { id: number }) => row.id,
  from: (key: number) => key + 1,
  end: 0,
};

function refill<Row extends { created_at: number }, Key>(
  src: Source<Row, Key>,
  count: number,
): void {
  const rows = src.fetch(src.before, count);
  src.examined += rows.length;
  if (rows.length > 0) {
    const last = rows.at(-1)!;
    src.before = src.keyOf(last);
    src.low = last.created_at;
    const passing = src.accept(rows);
    for (const row of rows) if (passing.has(row)) src.buffer.push(row);
  }
  if (rows.length < count) {
    src.exhausted = true;
    src.low = Number.NEGATIVE_INFINITY;
  }
}

const canRefill = (src: { exhausted: boolean; examined: number }) =>
  !src.exhausted && src.examined < FEED_EXAMINE_CAP;

/** The cursor part for a source: where its next fetch starts, or its end when nothing is left. */
function resume<Row extends { created_at: number }, Key>(src: Source<Row, Key>): Key {
  if (src.buffer.length > 0) return src.from(src.keyOf(src.buffer[0]!));
  return src.exhausted ? src.end : src.before;
}
const finished = (src: { exhausted: boolean; buffer: unknown[] }) =>
  src.exhausted && src.buffer.length === 0;

/** Newest first by merge time; at the same instant the forum side precedes a wall post. */
function earlier(
  a: { rank: number; row: { created_at: number } },
  b: { rank: number; row: { created_at: number } },
): boolean {
  if (a.row.created_at !== b.row.created_at) return a.row.created_at > b.row.created_at;
  return a.rank < b.rank;
}

type Picked = { kind: "post"; row: PostCandidate } | { kind: "wall"; row: WallCandidate };

/** Merges the two sources into at most `limit` items, doing bounded reads. */
function merge<PostKey, WallKey>(
  posts: Source<PostCandidate, PostKey>,
  walls: Source<WallCandidate, WallKey>,
  limit: number,
  batch: number,
): Picked[] {
  const out: Picked[] = [];
  while (out.length < limit) {
    const a = posts.buffer[0];
    const b = walls.buffer[0];
    if (a && b) {
      out.push(
        earlier({ rank: posts.rank, row: a }, { rank: walls.rank, row: b })
          ? { kind: "post", row: posts.buffer.shift()! }
          : { kind: "wall", row: walls.buffer.shift()! },
      );
    } else if (a) {
      // The head may go out only when nothing unexamined on the other side can be newer.
      if (walls.exhausted || a.created_at > walls.low)
        out.push({ kind: "post", row: posts.buffer.shift()! });
      else if (canRefill(walls)) refill(walls, batch);
      else break;
    } else if (b) {
      if (posts.exhausted || b.created_at > posts.low)
        out.push({ kind: "wall", row: walls.buffer.shift()! });
      else if (canRefill(posts)) refill(posts, batch);
      else break;
    } else {
      if (canRefill(posts)) refill(posts, batch);
      else if (canRefill(walls)) refill(walls, batch);
      else break;
    }
  }
  return out;
}

const OLDER_BATCH = 20;
/** How many posts back a thread is searched for a post the viewer may see despite blocks. */
const BLOCKED_LOOKBACK = 100;

/**
 * Replaces `row`, a thread's newest post by a member in a block with the viewer, with the newest
 * older post the viewer may read and is in no block with; false when the thread has none within
 * the last `BLOCKED_LOOKBACK` posts (the thread is then left out: the walk stays bounded per
 * request).
 */
function showNewestUnblocked(
  ctx: Ctx,
  actor: Actor,
  row: PostCandidate,
  nodeId: number,
  gates: ReturnType<typeof readGates>,
): boolean {
  const older = prepared(ctx, "feed.olderPosts", () =>
    ctx.sqlite.prepare<{ id: number; user_id: number }, [number, number]>(feedSql.olderPosts),
  );
  let from = row.id;
  for (let looked = 0; looked < BLOCKED_LOOKBACK; looked += OLDER_BATCH) {
    const batch = older.all(row.thread_id, from);
    const blocked = blockedAmong(
      ctx,
      actor,
      batch.map((post) => post.user_id),
    );
    const found = batch.find(
      (post) => !blocked.has(post.user_id) && gates.reads(nodeId, post.user_id),
    );
    if (found) {
      Object.assign(row, { id: found.id, user_id: found.user_id });
      return true;
    }
    if (batch.length < OLDER_BATCH) return false;
    from = batch[batch.length - 1]!.id;
  }
  return false;
}

/**
 * What the viewer may see of a batch of posts, with the threads loaded on the way. `once` makes
 * the feed a list of conversations: `newest` takes only a thread's newest visible post (what the
 * walk of threads by activity hands in, one candidate per thread); `perAnswer` keeps the first
 * post of a thread this request accepts and drops the older ones. `extra` is the feed filter's
 * check on the threads that passed everything else (see `planFeed`).
 */
export const acceptPosts = markPublic(
  "Filters a batch of posts to what the viewer may see; the viewer's forums are passed in.",
  function acceptPosts(
    ctx: Ctx,
    actor: Actor,
    nodes: Set<number>,
    threads: Map<number, ThreadRow>,
    once?: "newest" | "perAnswer",
    extra?: (threads: ThreadRow[]) => Set<number>,
  ) {
    const gates = readGates(ctx, actor);
    const taken = new Set<number>();
    const first = (threadId: number) => {
      if (taken.has(threadId)) return false;
      taken.add(threadId);
      return true;
    };
    return (rows: PostCandidate[]) => {
      loadThreads(ctx, rows, threads);
      // The walk of threads keeps a thread whose newest post is by a member in a block with the
      // viewer and shows an older post instead; a thread with no post by anyone else is left out.
      const blocked = blockedAmong(
        ctx,
        actor,
        rows.flatMap((row) => [row.user_id, threads.get(row.thread_id)?.user_id ?? 0]),
      );
      const open = rows.filter((row) => {
        const thread = threads.get(row.thread_id);
        return (
          row.state === "visible" &&
          thread !== undefined &&
          thread.state === "visible" &&
          thread.merged_into_id === null &&
          nodes.has(thread.node_id) &&
          // A thread the viewer may not open, or a post whose text is closed to them, is left out.
          gates.opens(thread.node_id, thread.user_id) &&
          gates.reads(thread.node_id, row.user_id) &&
          !gates.hidesAdult(thread) &&
          // A thread started by a member in a block with the viewer is not there for them.
          !blocked.has(thread.user_id) &&
          (once === "newest"
            ? row.id === thread.last_post_id &&
              (!blocked.has(row.user_id) ||
                showNewestUnblocked(ctx, actor, row, thread.node_id, gates))
            : !blocked.has(row.user_id))
        );
      });
      const passing = extra
        ? extra([...new Set(open.map((row) => threads.get(row.thread_id)!))])
        : undefined;
      // `perAnswer` takes a thread once per request, so it counts what everything else let through.
      return new Set(
        open.filter(
          (row) =>
            (!passing || passing.has(row.thread_id)) &&
            (once !== "perAnswer" || first(row.thread_id)),
        ),
      );
    };
  },
);

export const acceptWall = markPublic(
  "Filters a batch of wall posts to what the viewer may see.",
  function acceptWall(ctx: Ctx, actor: Actor) {
    return (rows: WallCandidate[]) => {
      const access = profileAccessMany(
        ctx,
        actor,
        rows.map((row) => row.profile_user_id),
      );
      const blocked = blockedAmong(
        ctx,
        actor,
        rows.map((row) => row.user_id),
      );
      return new Set(
        rows.filter((row) => {
          const owner = access.get(row.profile_user_id);
          return (
            row.state === "visible" &&
            owner !== undefined &&
            mayViewProfile(ctx, actor, row.profile_user_id, owner) &&
            !blocked.has(row.user_id)
          );
        }),
      );
    };
  },
);

/**
 * Builds the feed entries of the picked posts and wall posts, each reader loading once.
 * `featured` says why threads are featured when the caller already knows (the hot list).
 */
function build(
  ctx: Ctx,
  actor: Actor,
  picked: Picked[],
  threads: Map<number, ThreadRow>,
  featured?: Map<number, FeatureKind>,
) {
  const postRows = picked.flatMap((item) => (item.kind === "post" ? [item.row] : []));
  // Why each thread shown is featured: Hot already read it, the other scopes ask for the page.
  const kinds =
    featured ??
    featureKinds(
      ctx,
      postRows.map((row) => row.thread_id),
      ctx.now(),
    );
  const wallRows = picked.flatMap((item) => (item.kind === "wall" ? [item.row] : []));
  const followed = followedAmong(
    ctx,
    actor,
    picked.map((item) => item.row.user_id),
  );
  const postItems = new Map(
    postsInThreads(ctx, actor, postRows, threads).map((entry) => [entry.post.id, entry]),
  );
  const repliable = repliableThreads(
    ctx,
    actor,
    [...new Set(postRows.map((row) => row.thread_id))].flatMap((id) => threads.get(id) ?? []),
  );
  // What each unread thread of the page holds the viewer has not read: one statement.
  const unread = unreadIn(ctx, actor, [
    ...new Set([...postItems.values()].map((entry) => entry.thread)),
  ]);
  const wallItems = new Map<number, ReturnType<typeof profilePostValues>[number]>();
  if (wallRows.length > 0) {
    const rows = prepared(ctx, "feed.wallRows", () =>
      ctx.sqlite.prepare<ProfilePostRow, [string]>(feedSql.wallRows),
    ).all(JSON.stringify(wallRows.map((row) => row.id)));
    for (const value of profilePostValues(ctx, actor, rows, latestComments(ctx, actor, rows)))
      wallItems.set(value.id, value);
  }
  return picked.flatMap<FeedItemValue>((item) => {
    const following = followed.has(item.row.user_id);
    const createdAt = iso(item.row.created_at);
    if (item.kind === "wall") {
      const profilePost = wallItems.get(item.row.id);
      return profilePost
        ? [{ type: "profilePost" as const, createdAt, following, profilePost }]
        : [];
    }
    const entry = postItems.get(item.row.id);
    if (entry?.post.state !== "visible") return [];
    const type =
      entry.thread.firstPostId === entry.post.id ? ("thread" as const) : ("post" as const);
    return [
      {
        type,
        createdAt: entry.post.createdAt,
        following,
        canReply: repliable.has(entry.thread.id),
        featured: kinds.get(entry.thread.id) ?? null,
        unread: unread.get(entry.thread.id) ?? null,
        thread: entry.thread,
        post: entry.post,
      },
    ];
  });
}

/**
 * The two sides of `latest`, walked from `cursor`: every visible thread by activity (its newest
 * visible post) and the wall posts. With `since`, a walk stops at the first row not newer.
 */
function latestSources(
  ctx: Ctx,
  actor: Actor,
  plan: FeedPlan,
  threads: Map<number, ThreadRow>,
  cursor: z.infer<typeof cursorSchema.latest>,
  since?: number,
) {
  const [lastPostBefore, threadBefore, wallBefore] = cursor;
  // Threads older than the unread window are all read: the walk stops there. A walk that a bump
  // can reorder (the tag's) is not monotonic in last post time, so it keeps no such floor.
  const floor =
    plan.unreadAfter === undefined || plan.walk.reordered
      ? since
      : Math.max(since ?? 0, plan.unreadAfter);
  const latestWall = prepared(ctx, "feed.wall", () =>
    ctx.sqlite.prepare<WallCandidate, [number, number]>(feedSql.wall),
  );
  // Each visible thread, newest activity first, is one candidate: its newest visible post.
  const posts = source<PostCandidate, ThreadKey>({
    rank: 0,
    before: [lastPostBefore, threadBefore],
    since: floor,
    disabled: plan.noThreads,
    fetch: ([lastPostAt, threadId], count) =>
      plan.walk.fetch(lastPostAt, threadId, count).map((thread) => {
        threads.set(thread.id, thread);
        return {
          id: thread.last_post_id ?? 0,
          thread_id: thread.id,
          user_id: thread.last_poster_id,
          state: "visible",
          // What a client holds as the time of an entry is the post's, whatever the walk's order.
          created_at: thread.last_post_at,
        };
      }),
    accept: acceptPosts(ctx, actor, plan.nodes, threads, "newest", plan.accept),
    keyOf: (row) => [plan.walk.time(threads.get(row.thread_id)!), row.thread_id],
    from: ([lastPostAt, threadId]) => [lastPostAt, threadId + 1],
    end: [0, 0],
  });
  const walls = source<WallCandidate, number>({
    rank: 1,
    before: wallBefore,
    since,
    fetch: (before, count) => latestWall.all(before, count),
    accept: acceptWall(ctx, actor),
    ...byId,
    disabled:
      plan.threadsOnly || !can(ctx, actor, "profile.view") || !can(ctx, actor, "profilePost.view"),
  });
  return { posts, walls };
}

/**
 * The two sides of `following`, walked from `cursor`: the posts and the wall posts of the
 * members the viewer follows. With `since`, a walk stops at the first row not newer.
 */
function followingSources(
  ctx: Ctx,
  actor: Actor,
  plan: FeedPlan,
  threads: Map<number, ThreadRow>,
  cursor: z.infer<typeof cursorSchema.following>,
  since?: number,
) {
  const [postBefore, wallBefore] = cursor;
  const authors = followedAuthors(ctx, actor);
  const authorsJson = JSON.stringify(authors);
  const followedPosts = prepared(ctx, "feed.followedPosts", () =>
    ctx.sqlite.prepare<PostCandidate, [string, number, number]>(feedSql.followedPosts),
  );
  const followedWall = prepared(ctx, "feed.followedWall", () =>
    ctx.sqlite.prepare<WallCandidate, [string, number, number]>(feedSql.followedWall),
  );
  // Several authors: each walks its own newest rows, and the overall newest `count` are kept,
  // which is exactly the newest `count` of the union (no author can contribute more).
  const newest = <Row extends { id: number }>(rows: Row[], count: number) =>
    rows.sort((x, y) => y.id - x.id).slice(0, count);

  const posts = source<PostCandidate, number>({
    rank: 0,
    before: postBefore,
    since,
    disabled: plan.noThreads,
    fetch: (before, count) =>
      authors.length === 0 ? [] : newest(followedPosts.all(authorsJson, before, count), count),
    accept: acceptPosts(ctx, actor, plan.nodes, threads, "perAnswer", plan.accept),
    ...byId,
  });
  const walls = source<WallCandidate, number>({
    rank: 1,
    before: wallBefore,
    since,
    fetch: (before, count) =>
      authors.length === 0 ? [] : newest(followedWall.all(authorsJson, before, count), count),
    accept: acceptWall(ctx, actor),
    ...byId,
    disabled:
      plan.threadsOnly || !can(ctx, actor, "profile.view") || !can(ctx, actor, "profilePost.view"),
  });
  return { posts, walls };
}

export const feedListOp = implement(feedList, (ctx, actor, input) => {
  const { scope } = input;
  if (scope === "following") requireAuthenticated(actor);
  const plan = planFeed(ctx, actor, input, visibleNodes(ctx, actor));
  if (plan.empty) return { items: [], nextCursor: null };
  const threads = new Map<number, ThreadRow>();

  if (scope === "hot") {
    const accept = acceptPosts(ctx, actor, plan.nodes, threads, undefined, plan.accept);
    // The opening posts of the threads in a chunk of stored rows that the viewer may see.
    const loadOpenings = (chunk: { target_id: number }[]): Picked[] => {
      for (const thread of threadRowsByIds(
        ctx,
        chunk.map((row) => row.target_id),
      ))
        threads.set(thread.id, thread);
      const openings = chunk.flatMap((row) => {
        const id = threads.get(row.target_id)?.first_post_id;
        return id ? [id] : [];
      });
      const byId = new Map(
        prepared(ctx, "feed.hotPosts", () =>
          ctx.sqlite.prepare<PostCandidate, [string]>(feedSql.hotPosts),
        )
          .all(JSON.stringify(openings))
          .map((row) => [row.id, row] as const),
      );
      const candidates = openings.flatMap((id) => byId.get(id) ?? []);
      const passing = accept(candidates);
      return candidates.filter((row) => passing.has(row)).map((row) => ({ kind: "post", row }));
    };
    // Up to FEED_HOT_PINNED featured threads come first, newest feature first, whatever their
    // activity; the ranked threads follow without them. Both go through the same visibility filter.
    const featured = kindsOf(activeFeatures(ctx, ctx.now()));
    const pinned = firstSurvivors(
      [...featured.keys()].map((id) => ({ target_id: id })),
      FEED_HOT_PINNED,
      loadOpenings,
    );
    const pinnedIds = new Set(
      pinned.flatMap((item) => (item.kind === "post" ? [item.row.thread_id] : [])),
    );
    const ranked = firstSurvivors(
      storedRanking(ctx, "hot", plan.nodes).filter((row) => !pinnedIds.has(row.target_id)),
      FEED_HOT_SIZE - pinned.length,
      loadOpenings,
    );
    return {
      items: build(ctx, actor, [...pinned, ...ranked], threads, featured),
      nextCursor: null,
    };
  }

  const batch = Math.max(input.limit, MIN_BATCH);

  if (scope === "latest") {
    const { posts, walls } = latestSources(
      ctx,
      actor,
      plan,
      threads,
      input.cursor
        ? decodeCursor(input.cursor, cursorSchema.latest)
        : [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    );
    const items = build(ctx, actor, merge(posts, walls, input.limit, batch), threads);
    return {
      items,
      nextCursor:
        finished(posts) && finished(walls) ? null : encodeCursor([...resume(posts), resume(walls)]),
    };
  }

  const { posts, walls } = followingSources(
    ctx,
    actor,
    plan,
    threads,
    input.cursor
      ? decodeCursor(input.cursor, cursorSchema.following)
      : [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  );
  const items = build(ctx, actor, merge(posts, walls, input.limit, batch), threads);
  return {
    items,
    nextCursor:
      finished(posts) && finished(walls) ? null : encodeCursor([resume(posts), resume(walls)]),
  };
});

/** The most new entries `feed.newCount` reports. */
const NEW_COUNT_CAP = 99;

/** Entries a pair of walks yields, at most one more than the cap. */
const countNew = <PostKey, WallKey>(sources: {
  posts: Source<PostCandidate, PostKey>;
  walls: Source<WallCandidate, WallKey>;
}) => merge(sources.posts, sources.walls, NEW_COUNT_CAP + 1, MIN_BATCH).length;

export const feedNewCountOp = implement(feedNewCount, (ctx, actor, input) => {
  if (input.scope === "following") requireAuthenticated(actor);
  const since = Date.parse(input.since);
  const plan = planFeed(ctx, actor, input, visibleNodes(ctx, actor));
  if (plan.empty) return { count: 0, more: false };
  const threads = new Map<number, ThreadRow>();
  const top = Number.MAX_SAFE_INTEGER;
  // The same walks and filters as the list, from its top, stopping at what the client holds.
  const found =
    input.scope === "latest"
      ? countNew(latestSources(ctx, actor, plan, threads, [top, top, top], since))
      : countNew(followingSources(ctx, actor, plan, threads, [top, top], since));
  return { count: Math.min(found, NEW_COUNT_CAP), more: found > NEW_COUNT_CAP };
});
