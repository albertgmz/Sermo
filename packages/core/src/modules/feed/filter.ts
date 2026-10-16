import type * as z from "zod";
import { type Actor, actorUserId, requireAuthenticated } from "../../actor";
import { normalizeTag } from "../../bbcode/hashtag";
import { type Ctx, prepared } from "../../context";
import type { FeedFilter } from "../../contracts/feed";
import { markPublic } from "../../operation";
import { getNodeTree } from "../../permissions";
import { readGates, type ThreadRow, threadColumns, threadRowsByIds } from "../forums";
import { activeFeatures, featureKinds, kindsOf } from "../forums/features";
import { readSiteSettings } from "../settings";
import { hubSql, VIS_VISIBLE } from "../tags/hub";
import { tagIdOf } from "../tags/store";
import { rankingSql } from "./rankings";

export type FilterInput = z.infer<typeof FeedFilter>;

/** Named forums a walk visits one by one, at most; past it the walk reads every thread and filters. */
export const FORUM_WALK_MAX = 64;
/** The watched threads a filter looks at: the viewer's most recent watches. */
export const WATCHED_CAP = 500;
/** The featured threads a filter looks at: the newest features. */
export const FEATURED_CAP = 200;
/** A thread older than this counts as read (the rule of the unread flag everywhere else). */
const UNREAD_WINDOW_MS = 30 * 86_400_000;

export const filterSql = {
  /**
   * The place of the newest threads of each forum in `?1` below the key, one `threads_node_feed`
   * seek per forum; only the newest `?4` of all of them are read in full afterwards.
   */
  forums:
    "SELECT t.id, t.last_post_at FROM json_each(?1) AS j CROSS JOIN threads t WHERE t.id IN (SELECT t2.id FROM threads t2 WHERE t2.node_id = j.value AND t2.state = 'visible' AND (t2.last_post_at, t2.id) < (?2, ?3) ORDER BY t2.last_post_at DESC, t2.id DESC LIMIT ?4)",
  prefix: `SELECT ${threadColumns} FROM threads INDEXED BY threads_prefix_feed WHERE prefix_id = ?1 AND state = 'visible' AND (last_post_at, id) < (?2, ?3) ORDER BY last_post_at DESC, id DESC LIMIT ?4`,
  sticky: `SELECT ${threadColumns} FROM threads INDEXED BY threads_sticky_feed WHERE is_sticky = 1 AND state = 'visible' AND (last_post_at, id) < (?1, ?2) ORDER BY last_post_at DESC, id DESC LIMIT ?3`,
  locked: `SELECT ${threadColumns} FROM threads INDEXED BY threads_locked_feed WHERE is_locked = 1 AND state = 'visible' AND (last_post_at, id) < (?1, ?2) ORDER BY last_post_at DESC, id DESC LIMIT ?3`,
  /** The viewer's watches, newest first: `thread_watches_user`. */
  watched: "SELECT thread_id FROM thread_watches WHERE user_id = ?1 ORDER BY id DESC LIMIT ?2",
  /** Which of the threads in `?2` the viewer watches: `thread_watches_thread_user`. */
  watchedAmong:
    "SELECT thread_id FROM thread_watches INDEXED BY thread_watches_thread_user WHERE user_id = ?1 AND thread_id IN (SELECT value FROM json_each(?2))",
  /** Which of the threads in `?2` carry the tag: `thread_tags_thread_tag`. */
  taggedAmong:
    "SELECT thread_id, from_post FROM thread_tags INDEXED BY thread_tags_thread_tag WHERE tag_id = ?1 AND vis = ?3 AND thread_id IN (SELECT value FROM json_each(?2))",
  /** What the viewer has read of the threads in `?2`: `thread_reads_user_thread`. */
  reads:
    "SELECT thread_id, last_read_post_id FROM thread_reads INDEXED BY thread_reads_user_thread WHERE user_id = ?1 AND thread_id IN (SELECT value FROM json_each(?2))",
  hidden: "SELECT node_id FROM feed_hidden_nodes WHERE user_id = ?1",
};

/**
 * Where a walk of threads gets them: newest activity first, below the key `(time, id)`. `time` is
 * the thread's place in the order, which is its last post, except for the tag walk (the tag
 * page's own order, `sort_at`, which a bump moves).
 */
export interface ThreadWalk {
  fetch(time: number, id: number, count: number): ThreadRow[];
  time(thread: ThreadRow): number;
  /** The order is not by last post alone: a bump can put an older post above a newer one. */
  reordered?: true;
}

const byLastPost = (thread: ThreadRow) => thread.last_post_at;

function sqlWalk(
  ctx: Ctx,
  key: string,
  sql: string,
  bind: (time: number, id: number, count: number) => (number | string)[],
): ThreadWalk {
  return {
    fetch: (time, id, count) =>
      prepared(ctx, key, () => ctx.sqlite.prepare<ThreadRow, (number | string)[]>(sql)).all(
        ...bind(time, id, count),
      ),
    time: byLastPost,
  };
}

/** The threads of a set held in memory, walked newest activity first. */
function setWalk(load: () => ThreadRow[]): ThreadWalk {
  let rows: ThreadRow[] | undefined;
  return {
    fetch(time, id, count) {
      rows ??= load().sort((a, b) => b.last_post_at - a.last_post_at || b.id - a.id);
      return rows
        .filter((row) => row.last_post_at < time || (row.last_post_at === time && row.id < id))
        .slice(0, count);
    },
    time: byLastPost,
  };
}

/** The visible, unmerged threads among these ids. */
function openThreads(ctx: Ctx, ids: number[]): ThreadRow[] {
  return threadRowsByIds(ctx, ids).filter(
    (thread) => thread.state === "visible" && thread.merged_into_id === null,
  );
}

function forumsWalk(ctx: Ctx, forums: number[]): ThreadWalk {
  const json = JSON.stringify(forums);
  return {
    // Each forum's newest `count` below the key; the newest `count` of all of them are the
    // newest `count` of their union.
    fetch: (time, id, count) => {
      const newest = prepared(ctx, "feed.forumsWalk", () =>
        ctx.sqlite.prepare<{ id: number; last_post_at: number }, [string, number, number, number]>(
          filterSql.forums,
        ),
      )
        .all(json, time, id, count)
        .sort((a, b) => b.last_post_at - a.last_post_at || b.id - a.id)
        .slice(0, count);
      const rows = new Map(
        threadRowsByIds(
          ctx,
          newest.map((row) => row.id),
        ).map((t) => [t.id, t]),
      );
      return newest.flatMap((row) => rows.get(row.id) ?? []);
    },
    time: byLastPost,
  };
}

function tagWalk(ctx: Ctx, tagId: number): ThreadWalk {
  return {
    fetch(time, id, count) {
      const candidates = prepared(ctx, "feed.tagWalk", () =>
        ctx.sqlite.prepare<
          { thread_id: number; sort_at: number; from_post: number },
          [number, number, number, number, number]
        >(hubSql.byVis),
      ).all(tagId, VIS_VISIBLE, time, id, count);
      const rows = new Map(
        threadRowsByIds(
          ctx,
          candidates.map((c) => c.thread_id),
        ).map((t) => [t.id, t]),
      );
      return candidates.flatMap((candidate) => rows.get(candidate.thread_id) ?? []);
    },
    time: (thread) => thread.sort_at,
    reordered: true,
  };
}

/**
 * What one request of the feed is narrowed to: the forums a thread may be in, the walk that
 * reads candidates in order, and the per-batch check for the fields no index orders by.
 */
export interface FeedPlan {
  /** Forums a thread may be in: what the viewer sees, less the site's exclusions and their own. */
  nodes: Set<number>;
  /** A field is on: the feed holds threads only, no wall posts. */
  threadsOnly: boolean;
  /** Nothing can match: a tag nobody has, or a filter on threads with no forum left. */
  empty: boolean;
  /** No forum is left: no thread is listed, the wall posts still can be. */
  noThreads: boolean;
  walk: ThreadWalk;
  /** The threads of a batch that pass the fields the walk does not guarantee; none when no field needs it. */
  accept: ((threads: ThreadRow[]) => Set<number>) | undefined;
  /** With `unread`: threads whose last post is not newer than this count as read. */
  unreadAfter: number | undefined;
}

const subtreeOf = (ctx: Ctx, ids: Iterable<number>): Set<number> => {
  const tree = getNodeTree(ctx);
  const result = new Set<number>();
  for (const id of ids) for (const node of tree.subtreeIds(id)) result.add(node);
  return result;
};

/** The forums the member keeps out of their own feed (ids as chosen, not their subforums). */
export function hiddenForumIds(ctx: Ctx, userId: number | null): number[] {
  if (userId === null) return [];
  return prepared(ctx, "feed.hidden", () =>
    ctx.sqlite.prepare<{ node_id: number }, [number]>(filterSql.hidden),
  )
    .all(userId)
    .map((row) => row.node_id);
}

/**
 * The forums the home feed's side blocks (featured, the rankings) show: what the viewer sees less
 * the forums the site leaves out and the ones the member hides, each with what is under it.
 */
export const feedNodes = markPublic(
  "Narrows what the caller already decided the viewer may see; it widens nothing.",
  function feedNodes(ctx: Ctx, actor: Actor, visible: Set<number>): Set<number> {
    const out = subtreeOf(ctx, readSiteSettings(ctx).feedExcludedForumIds);
    for (const id of subtreeOf(ctx, hiddenForumIds(ctx, actorUserId(actor)))) out.add(id);
    return new Set([...visible].filter((id) => !out.has(id)));
  },
);

/**
 * Works out a request: `visible` is what the viewer may see. A forum the site excludes is never
 * in `nodes`, with its subforums; one the member hid is left out unless the filter names a forum,
 * which lists what it names (a choice made now beats a standing preference, and widens nothing:
 * `nodes` stays inside `visible`).
 */
export const planFeed = markPublic(
  "Narrows what the caller already decided the viewer may see; it widens nothing.",
  function planFeed(ctx: Ctx, actor: Actor, filter: FilterInput, visible: Set<number>): FeedPlan {
    const viewerId = actorUserId(actor);
    if (filter.watched || filter.unread) requireAuthenticated(actor);
    const tree = getNodeTree(ctx);
    const excluded = subtreeOf(ctx, readSiteSettings(ctx).feedExcludedForumIds);
    const named =
      filter.forumIds && filter.forumIds.length > 0 ? subtreeOf(ctx, filter.forumIds) : null;
    const hidden =
      named === null ? subtreeOf(ctx, hiddenForumIds(ctx, viewerId)) : new Set<number>();
    const nodes = new Set<number>();
    for (const id of visible)
      if (!excluded.has(id) && !hidden.has(id) && (named === null || named.has(id))) nodes.add(id);

    const tag = filter.tag === undefined ? undefined : normalizeTag(filter.tag);
    const tagId = tag === undefined ? undefined : tag === null ? null : tagIdOf(ctx, tag);
    const threadsOnly = Boolean(
      named ||
        filter.prefixId !== undefined ||
        filter.type !== undefined ||
        tagId !== undefined ||
        filter.watched ||
        filter.unread,
    );

    // The forums a walk would visit one by one: only the ones the filter names.
    const forums =
      named === null ? null : [...nodes].filter((id) => tree.get(id)?.type === "forum");
    const now = ctx.now();
    const viewer = viewerId ?? 0;

    let walk: ThreadWalk;
    if (tagId) walk = tagWalk(ctx, tagId);
    else if (filter.watched)
      walk = setWalk(() =>
        openThreads(
          ctx,
          prepared(ctx, "feed.watched", () =>
            ctx.sqlite.prepare<{ thread_id: number }, [number, number]>(filterSql.watched),
          )
            .all(viewer, WATCHED_CAP)
            .map((row) => row.thread_id),
        ),
      );
    else if (filter.type === "featured")
      walk = setWalk(() =>
        openThreads(ctx, [...kindsOf(activeFeatures(ctx, now).slice(0, FEATURED_CAP)).keys()]),
      );
    else if (forums && forums.length <= FORUM_WALK_MAX) walk = forumsWalk(ctx, forums);
    // A prefix, a pinned or a locked thread is rare: its own index bounds the walk, and `nodes`
    // (what the site and the member leave out) is applied to what it finds.
    else if (filter.prefixId !== undefined)
      walk = sqlWalk(ctx, "feed.prefixWalk", filterSql.prefix, (time, id, count) => [
        filter.prefixId!,
        time,
        id,
        count,
      ]);
    else if (filter.type === "sticky" || filter.type === "locked")
      walk = sqlWalk(ctx, `feed.${filter.type}Walk`, filterSql[filter.type], (time, id, count) => [
        time,
        id,
        count,
      ]);
    else
      walk = sqlWalk(ctx, "feed.latestPosts", rankingSql.latestPosts, (time, id, count) => [
        time,
        id,
        count,
      ]);

    const unreadAfter = filter.unread ? now - UNREAD_WINDOW_MS : undefined;
    // No thread can match: a tag nobody has, or a filter on threads with no forum left. Without a
    // filter, no forum left still leaves the wall posts.
    const noThreads = nodes.size === 0;
    const empty = tagId === null || (threadsOnly && noThreads);
    return {
      nodes,
      threadsOnly,
      empty,
      noThreads,
      walk,
      accept: threadPredicate(ctx, actor, filter, tagId ?? undefined, unreadAfter),
      unreadAfter,
    };
  },
);

/**
 * The fields no walk orders by, checked on a batch of threads: the cheap ones on the rows first,
 * then one indexed lookup per field on what is left (never a scan: each probes by thread id).
 */
function threadPredicate(
  ctx: Ctx,
  actor: Actor,
  filter: FilterInput,
  tagId: number | undefined,
  unreadAfter: number | undefined,
): ((threads: ThreadRow[]) => Set<number>) | undefined {
  const { prefixId, type } = filter;
  if (
    prefixId === undefined &&
    type === undefined &&
    tagId === undefined &&
    !filter.watched &&
    !filter.unread
  )
    return undefined;
  const viewer = actorUserId(actor) ?? 0;
  const gates = tagId === undefined ? undefined : readGates(ctx, actor);
  const idsOf = (threads: ThreadRow[]) => JSON.stringify(threads.map((thread) => thread.id));
  return (batch) => {
    let rows = batch;
    if (prefixId !== undefined) rows = rows.filter((thread) => thread.prefix_id === prefixId);
    if (type === "sticky") rows = rows.filter((thread) => thread.is_sticky === 1);
    if (type === "locked") rows = rows.filter((thread) => thread.is_locked === 1);
    if (unreadAfter !== undefined)
      rows = rows.filter((thread) => thread.last_post_at > unreadAfter);
    if (type === "featured" && rows.length > 0) {
      const kinds = featureKinds(
        ctx,
        rows.map((thread) => thread.id),
        ctx.now(),
      );
      rows = rows.filter((thread) => kinds.has(thread.id));
    }
    if (unreadAfter !== undefined && rows.length > 0) {
      const reads = new Map(
        prepared(ctx, "feed.reads", () =>
          ctx.sqlite.prepare<{ thread_id: number; last_read_post_id: number }, [number, string]>(
            filterSql.reads,
          ),
        )
          .all(viewer, idsOf(rows))
          .map((row) => [row.thread_id, row.last_read_post_id] as const),
      );
      rows = rows.filter((thread) => thread.last_post_id > (reads.get(thread.id) ?? 0));
    }
    if (filter.watched && rows.length > 0) {
      const watched = new Set(
        prepared(ctx, "feed.watchedAmong", () =>
          ctx.sqlite.prepare<{ thread_id: number }, [number, string]>(filterSql.watchedAmong),
        )
          .all(viewer, idsOf(rows))
          .map((row) => row.thread_id),
      );
      rows = rows.filter((thread) => watched.has(thread.id));
    }
    if (tagId !== undefined && rows.length > 0) {
      const fromPost = new Map(
        prepared(ctx, "feed.taggedAmong", () =>
          ctx.sqlite.prepare<{ thread_id: number; from_post: number }, [number, string, number]>(
            filterSql.taggedAmong,
          ),
        )
          .all(tagId, idsOf(rows), VIS_VISIBLE)
          .map((row) => [row.thread_id, row.from_post === 1] as const),
      );
      // A tag the opening post's hashtags gave is that post's text: closed to a viewer who may not read it.
      rows = rows.filter((thread) => {
        const opening = fromPost.get(thread.id);
        return opening !== undefined && (!opening || gates?.reads(thread.node_id, thread.user_id));
      });
    }
    return new Set(rows.map((thread) => thread.id));
  };
}
