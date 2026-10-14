import * as z from "zod";
import { type Actor, requireAuthenticated } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { type FeedItem, feedList } from "../../contracts/feed";
import { implement } from "../../operation";
import { decodeCursor, encodeCursor } from "../../pagination";
import { can } from "../../permissions";
import { iso } from "../../time";
import { repliableThreads, type ThreadRow } from "../forums";
import {
  latestComments,
  mayViewProfile,
  type ProfilePostRow,
  profileAccessMany,
  profilePostValues,
} from "../profiles";
import { loadThreads, postsInThreads } from "./authors";
import { FEED_TOP_SIZE, firstSurvivors, rankingSql, storedRanking } from "./rankings";
import { SCAN_CAP } from "./scan";
import { followedAmong, followedAuthors, ignoredAmong, visibleNodes } from "./viewer";

/** Posts examined per source per request, at most. */
const FEED_EXAMINE_CAP = SCAN_CAP;
const MIN_BATCH = 10;

type PostCandidate = {
  id: number;
  thread_id: number;
  user_id: number;
  state: "visible" | "moderated" | "deleted";
  created_at: number;
};
type WallCandidate = {
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
  topPosts:
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
  },
): Source<Row, Key> {
  const { before, disabled = false, ...walk } = options;
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

/**
 * What the viewer may see of a batch of posts, with the threads loaded on the way. `once` makes
 * the feed a list of conversations: `newest` takes only a thread's newest visible post (what the
 * walk of threads by activity hands in, one candidate per thread); `perAnswer` keeps the first
 * post of a thread this request accepts and drops the older ones.
 */
function acceptPosts(
  ctx: Ctx,
  actor: Actor,
  nodes: Set<number>,
  threads: Map<number, ThreadRow>,
  once?: "newest" | "perAnswer",
) {
  const taken = new Set<number>();
  const first = (threadId: number) => {
    if (taken.has(threadId)) return false;
    taken.add(threadId);
    return true;
  };
  return (rows: PostCandidate[]) => {
    loadThreads(ctx, rows, threads);
    const ignored = ignoredAmong(
      ctx,
      actor,
      rows.map((row) => row.user_id),
    );
    return new Set(
      rows.filter((row) => {
        const thread = threads.get(row.thread_id);
        return (
          row.state === "visible" &&
          thread !== undefined &&
          thread.state === "visible" &&
          thread.merged_into_id === null &&
          nodes.has(thread.node_id) &&
          !ignored.has(row.user_id) &&
          (once !== "newest" || row.id === thread.last_post_id) &&
          (once !== "perAnswer" || first(thread.id))
        );
      }),
    );
  };
}

function acceptWall(ctx: Ctx, actor: Actor) {
  return (rows: WallCandidate[]) => {
    const access = profileAccessMany(
      ctx,
      actor,
      rows.map((row) => row.profile_user_id),
    );
    const ignored = ignoredAmong(
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
          !ignored.has(row.user_id)
        );
      }),
    );
  };
}

/** Builds the feed entries of the picked posts and wall posts, each reader loading once. */
function build(ctx: Ctx, actor: Actor, picked: Picked[], threads: Map<number, ThreadRow>) {
  const postRows = picked.flatMap((item) => (item.kind === "post" ? [item.row] : []));
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
        thread: entry.thread,
        post: entry.post,
      },
    ];
  });
}

export const feedListOp = implement(feedList, (ctx, actor, input) => {
  const scope = input.scope;
  if (scope === "following") requireAuthenticated(actor);
  const nodes = visibleNodes(ctx, actor);
  const threads = new Map<number, ThreadRow>();

  if (scope === "top") {
    const accept = acceptPosts(ctx, actor, nodes, threads);
    const picked = firstSurvivors(
      storedRanking(ctx, "feedTop", nodes),
      FEED_TOP_SIZE,
      (chunk): Picked[] => {
        const byId = new Map(
          prepared(ctx, "feed.topPosts", () =>
            ctx.sqlite.prepare<PostCandidate, [string]>(feedSql.topPosts),
          )
            .all(JSON.stringify(chunk.map((row) => row.target_id)))
            .map((row) => [row.id, row] as const),
        );
        const candidates = chunk.flatMap((row) => byId.get(row.target_id) ?? []);
        const passing = accept(candidates);
        return candidates.filter((row) => passing.has(row)).map((row) => ({ kind: "post", row }));
      },
    );
    return { items: build(ctx, actor, picked, threads), nextCursor: null };
  }

  const batch = Math.max(input.limit, MIN_BATCH);
  const mayOpenProfiles = can(ctx, actor, "profile.view");

  if (scope === "latest") {
    const [lastPostBefore, threadBefore, wallBefore] = input.cursor
      ? decodeCursor(input.cursor, cursorSchema.latest)
      : [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
    const latestThreads = prepared(ctx, "feed.latestPosts", () =>
      ctx.sqlite.prepare<ThreadRow, [number, number, number]>(rankingSql.latestPosts),
    );
    const latestWall = prepared(ctx, "feed.wall", () =>
      ctx.sqlite.prepare<WallCandidate, [number, number]>(feedSql.wall),
    );
    // Each visible thread, newest activity first, is one candidate: its newest visible post.
    const posts = source<PostCandidate, ThreadKey>({
      rank: 0,
      before: [lastPostBefore, threadBefore],
      fetch: ([lastPostAt, threadId], count) =>
        latestThreads.all(lastPostAt, threadId, count).map((thread) => {
          threads.set(thread.id, thread);
          return {
            id: thread.last_post_id ?? 0,
            thread_id: thread.id,
            user_id: thread.last_poster_id,
            state: "visible",
            created_at: thread.last_post_at,
          };
        }),
      accept: acceptPosts(ctx, actor, nodes, threads, "newest"),
      keyOf: (row) => [row.created_at, row.thread_id],
      from: ([lastPostAt, threadId]) => [lastPostAt, threadId + 1],
      end: [0, 0],
    });
    const walls = source<WallCandidate, number>({
      rank: 1,
      before: wallBefore,
      fetch: (before, count) => latestWall.all(before, count),
      accept: acceptWall(ctx, actor),
      ...byId,
      disabled: !mayOpenProfiles,
    });
    const items = build(ctx, actor, merge(posts, walls, input.limit, batch), threads);
    return {
      items,
      nextCursor:
        finished(posts) && finished(walls) ? null : encodeCursor([...resume(posts), resume(walls)]),
    };
  }

  const [postBefore, wallBefore] = input.cursor
    ? decodeCursor(input.cursor, cursorSchema.following)
    : [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
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
    fetch: (before, count) =>
      authors.length === 0 ? [] : newest(followedPosts.all(authorsJson, before, count), count),
    accept: acceptPosts(ctx, actor, nodes, threads, "perAnswer"),
    ...byId,
  });
  const walls = source<WallCandidate, number>({
    rank: 1,
    before: wallBefore,
    fetch: (before, count) =>
      authors.length === 0 ? [] : newest(followedWall.all(authorsJson, before, count), count),
    accept: acceptWall(ctx, actor),
    ...byId,
    disabled: !mayOpenProfiles,
  });
  const items = build(ctx, actor, merge(posts, walls, input.limit, batch), threads);
  return {
    items,
    nextCursor:
      finished(posts) && finished(walls) ? null : encodeCursor([resume(posts), resume(walls)]),
  };
});
