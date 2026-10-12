import * as z from "zod";
import { type Actor, requireAuthenticated } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { type FeedItem, feedList } from "../../contracts/feed";
import { implement } from "../../operation";
import { decodeCursor, encodeCursor } from "../../pagination";
import { can } from "../../permissions";
import { iso } from "../../time";
import type { ThreadRow } from "../forums";
import {
  latestComments,
  mayViewProfile,
  type ProfileAccess,
  type ProfilePostRow,
  profilePostValues,
} from "../profiles";
import { loadThreads, postsInThreads } from "./authors";
import { SCAN_CAP } from "./scan";
import { followedAmong, followedAuthors, ignoredAmong, visibleNodes } from "./viewer";

/** Posts examined per source per request, at most. */
export const FEED_EXAMINE_CAP = SCAN_CAP;
/** The most items the `top` scope returns. */
export const FEED_TOP_LIMIT = 50;
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
  posts:
    "SELECT id, thread_id, user_id, state, created_at FROM posts WHERE state = 'visible' AND id < ?1 ORDER BY id DESC LIMIT ?2",
  wall: "SELECT id, profile_user_id, user_id, state, created_at FROM profile_posts WHERE state = 'visible' AND id < ?1 ORDER BY id DESC LIMIT ?2",
  /**
   * The newest posts of any of the given authors: each author's newest rows by the (user, id)
   * index, merged by the caller. `?3` bounds every author's walk.
   */
  followedPosts:
    "SELECT p.id, p.thread_id, p.user_id, p.state, p.created_at FROM json_each(?1) AS j CROSS JOIN posts p WHERE p.id IN (SELECT p2.id FROM posts p2 WHERE p2.user_id = j.value AND p2.id < ?2 ORDER BY p2.id DESC LIMIT ?3)",
  followedWall:
    "SELECT p.id, p.profile_user_id, p.user_id, p.state, p.created_at FROM json_each(?1) AS j CROSS JOIN profile_posts p WHERE p.id IN (SELECT p2.id FROM profile_posts p2 WHERE p2.user_id = j.value AND p2.id < ?2 ORDER BY p2.id DESC LIMIT ?3)",
  wallOwners:
    "SELECT u.id, u.profile_view_privacy, u.profile_post_privacy, EXISTS(SELECT 1 FROM user_follows f WHERE f.user_id = u.id AND f.followed_id = ?1) AS follows FROM users u WHERE u.id IN (SELECT value FROM json_each(?2))",
  wallRows: "SELECT * FROM profile_posts WHERE id IN (SELECT value FROM json_each(?1))",
  top: "SELECT target_id FROM rankings WHERE kind = 'feedTop' ORDER BY position",
  topPosts:
    "SELECT id, thread_id, user_id, state, created_at FROM posts WHERE id IN (SELECT value FROM json_each(?1))",
};

type FeedItemValue = z.infer<typeof FeedItem>;
const cursorSchema = z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]);

/** One side of the merged stream: posts, or wall posts. */
interface Source<Row extends { id: number; created_at: number }> {
  readonly rank: number;
  /** Rows with id below `before`, newest id first, at most `count`; fewer only at the end. */
  fetch(before: number, count: number): Row[];
  /** The rows the viewer may see. */
  accept(rows: Row[]): Set<Row>;
  /** Exclusive upper bound of the next fetch. */
  before: number;
  buffer: Row[];
  examined: number;
  exhausted: boolean;
  /** Creation time of the oldest row examined: nothing unexamined is newer. */
  low: number;
}

function source<Row extends { id: number; created_at: number }>(
  rank: number,
  before: number,
  fetch: Source<Row>["fetch"],
  accept: Source<Row>["accept"],
  disabled = false,
): Source<Row> {
  return {
    rank,
    fetch,
    accept,
    before,
    buffer: [],
    examined: 0,
    exhausted: disabled || before === 0,
    low: disabled || before === 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
  };
}

function refill<Row extends { id: number; created_at: number }>(
  src: Source<Row>,
  count: number,
): void {
  const rows = src.fetch(src.before, count);
  src.examined += rows.length;
  if (rows.length > 0) {
    const last = rows.at(-1)!;
    src.before = last.id;
    src.low = last.created_at;
    const passing = src.accept(rows);
    for (const row of rows) if (passing.has(row)) src.buffer.push(row);
  }
  if (rows.length < count) {
    src.exhausted = true;
    src.low = Number.NEGATIVE_INFINITY;
  }
}

const canRefill = (src: Source<{ id: number; created_at: number }>) =>
  !src.exhausted && src.examined < FEED_EXAMINE_CAP;

/** The cursor part for a source: where its next fetch starts, or 0 when it has nothing more. */
function resume(src: Source<{ id: number; created_at: number }>): number {
  if (src.buffer.length > 0) return src.buffer[0]!.id + 1;
  return src.exhausted ? 0 : src.before;
}

/**
 * Newest first by creation time; at the same instant a post precedes a wall post, then the
 * higher id first.
 */
function earlier(
  a: { rank: number; row: { id: number; created_at: number } },
  b: { rank: number; row: { id: number; created_at: number } },
): boolean {
  if (a.row.created_at !== b.row.created_at) return a.row.created_at > b.row.created_at;
  if (a.rank !== b.rank) return a.rank < b.rank;
  return a.row.id > b.row.id;
}

type Picked = { kind: "post"; row: PostCandidate } | { kind: "wall"; row: WallCandidate };

/** Merges the two sources into at most `limit` items, doing bounded reads. */
function merge(
  posts: Source<PostCandidate>,
  walls: Source<WallCandidate>,
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

/** What the viewer may see of a batch of posts, with the threads loaded on the way. */
function acceptPosts(ctx: Ctx, actor: Actor, nodes: Set<number>, threads: Map<number, ThreadRow>) {
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
          !ignored.has(row.user_id)
        );
      }),
    );
  };
}

function acceptWall(ctx: Ctx, actor: Actor) {
  return (rows: WallCandidate[]) => {
    const viewerId = actor.kind === "guest" ? 0 : actor.userId;
    const access = new Map(
      prepared(ctx, "feed.wallOwners", () =>
        ctx.sqlite.prepare<
          { id: number } & Omit<ProfileAccess, "follows"> & { follows: number },
          [number, string]
        >(feedSql.wallOwners),
      )
        .all(viewerId, JSON.stringify([...new Set(rows.map((row) => row.profile_user_id))]))
        .map((row) => [row.id, row as ProfileAccess] as const),
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
    if (!entry) return [];
    const type =
      entry.thread.firstPostId === entry.post.id ? ("thread" as const) : ("post" as const);
    return [{ type, createdAt, following, thread: entry.thread, post: entry.post }];
  });
}

export const feedListOp = implement(feedList, (ctx, actor, input) => {
  const scope = input.scope;
  if (scope === "following") requireAuthenticated(actor);
  const nodes = visibleNodes(ctx, actor);
  const threads = new Map<number, ThreadRow>();

  if (scope === "top") {
    const ids = prepared(ctx, "feed.top", () =>
      ctx.sqlite.prepare<{ target_id: number }, []>(feedSql.top),
    )
      .all()
      .map((row) => row.target_id);
    const byId = new Map(
      (ids.length === 0
        ? []
        : prepared(ctx, "feed.topPosts", () =>
            ctx.sqlite.prepare<PostCandidate, [string]>(feedSql.topPosts),
          ).all(JSON.stringify(ids))
      ).map((row) => [row.id, row]),
    );
    const candidates = ids.flatMap((id) => byId.get(id) ?? []);
    const passing = acceptPosts(ctx, actor, nodes, threads)(candidates);
    const picked: Picked[] = candidates
      .filter((row) => passing.has(row))
      .slice(0, FEED_TOP_LIMIT)
      .map((row) => ({ kind: "post", row }));
    return { items: build(ctx, actor, picked, threads), nextCursor: null };
  }

  const batch = Math.max(input.limit, MIN_BATCH);
  const [postBefore, wallBefore] = input.cursor
    ? decodeCursor(input.cursor, cursorSchema)
    : [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
  const authors = scope === "following" ? followedAuthors(ctx, actor) : null;
  const authorsJson = JSON.stringify(authors ?? []);
  const mayOpenProfiles = can(ctx, actor, "profile.view");

  const latestPosts = prepared(ctx, "feed.posts", () =>
    ctx.sqlite.prepare<PostCandidate, [number, number]>(feedSql.posts),
  );
  const latestWall = prepared(ctx, "feed.wall", () =>
    ctx.sqlite.prepare<WallCandidate, [number, number]>(feedSql.wall),
  );
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

  const posts = source<PostCandidate>(
    0,
    postBefore,
    authors
      ? (before, count) =>
          authors.length === 0 ? [] : newest(followedPosts.all(authorsJson, before, count), count)
      : (before, count) => latestPosts.all(before, count),
    acceptPosts(ctx, actor, nodes, threads),
  );
  const walls = source<WallCandidate>(
    1,
    wallBefore,
    authors
      ? (before, count) =>
          authors.length === 0 ? [] : newest(followedWall.all(authorsJson, before, count), count)
      : (before, count) => latestWall.all(before, count),
    acceptWall(ctx, actor),
    !mayOpenProfiles,
  );
  const picked = merge(posts, walls, input.limit, batch);
  const items = build(ctx, actor, picked, threads);
  const done = resume(posts) === 0 && resume(walls) === 0;
  return {
    items,
    nextCursor: done ? null : encodeCursor([resume(posts), resume(walls)]),
  };
});
