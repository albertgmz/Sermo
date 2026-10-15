import * as z from "zod";
import { defineContract } from "../operation";
import { Id, Page, pageInput, Timestamp } from "./common";
import { FeatureKind, Post, Thread } from "./forums";
import { ProfilePost } from "./profiles";

/*
 * Reads that cut across forums: the home feed, the thread rankings, and what one member wrote.
 * Everything here is filtered to what the viewer may open, so a page can hold fewer than `limit`
 * items while `nextCursor` is still non-null; keep paging to continue.
 */

/** A post with the thread it belongs to, for listings outside the thread. */
export const PostInThread = z.object({ post: Post, thread: Thread }).meta({ id: "PostInThread" });

/**
 * One entry of the feed: a conversation. `thread` and `post` are a thread, shown with one of its
 * posts: `thread` when that post is the opening post, `post` when it is a reply (in `latest`,
 * the newest visible reply). `profilePost` is a post on a member's wall, with its latest
 * comments. `createdAt` is the creation time of the post or wall post shown, which for `latest`
 * is the thread's last activity (`thread.lastPost.postedAt`). `following` says whether the
 * viewer follows the author of the post shown (always false for guests). `canReply` says whether
 * `posts.create` would take a reply from the viewer in that thread, before it looks at the reply
 * itself: the reply permission, a thread ban, a locked thread and the forum's posting rules
 * (read-only, minimum account age and post count), as `threads.get` answers it. A wall post says
 * the same in `profilePost.canComment`. `featured` is why the thread is featured right now
 * (`staff`, `paid`) or null, for the card's mark.
 */
export const FeedItem = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("thread"),
      createdAt: Timestamp,
      following: z.boolean(),
      canReply: z.boolean(),
      featured: FeatureKind.nullable(),
      thread: Thread,
      post: Post,
    }),
    z.object({
      type: z.literal("post"),
      createdAt: Timestamp,
      following: z.boolean(),
      canReply: z.boolean(),
      featured: FeatureKind.nullable(),
      thread: Thread,
      post: Post,
    }),
    z.object({
      type: z.literal("profilePost"),
      createdAt: Timestamp,
      following: z.boolean(),
      profilePost: ProfilePost,
    }),
  ])
  .meta({ id: "FeedItem" });

export const FEED_SCOPES = ["latest", "following", "hot"] as const;

export const feedList = defineContract({
  name: "feed.list",
  summary:
    "The feed of conversations, newest first: threads and wall posts the viewer may open. " +
    "`latest` is everyone's activity, one entry per thread: the visible threads are walked by " +
    "their last activity and each is listed once, with its newest visible post (its opening " +
    "post, or its newest reply), merged with the wall posts by time. A reply moves its thread " +
    "to the top; while paging, a thread that gets a reply is not listed a second time further " +
    "down. A thread whose newest post is by a member the viewer ignores is left out. " +
    "`following` is the activity of the members the viewer follows (the 100 followed most " +
    "recently, when there are more) and requires an account: a thread is listed at the newest " +
    "post one of them wrote in it, once per answer; a later page may list the same thread " +
    "again, with an older post of a followed member. A cursor belongs to the scope that " +
    "issued it. " +
    "`hot` is the threads that are busy right now among the forums the viewer can see, at most " +
    "50, each as its opening post, best first; it is recomputed every five minutes and not " +
    "paginated (`nextCursor` is always null). A thread scores its replies, the reactions on its " +
    "opening post and its views, divided by its age (a gravity formula), and is not listed " +
    "before it has 3 replies or 3 reactions on its opening post. Threads hidden since the last " +
    "refresh are left out and replaced by the next best, as far as the stored ranking " +
    "reaches. Up to 10 featured threads (staff picks and paid promotions, see " +
    "`threads.featured`) come first, newest feature first, whatever their activity, then the " +
    "ranked threads without them, all within the same 50; they follow the same visibility rules. " +
    "A featured thread beyond the 10 is listed only where it ranks. Threads of ignored " +
    "members are left out. `top` is the former name of `hot` and is accepted as an alias for " +
    "one release. A thread entry says whether the viewer may reply to it (`canReply`) and why " +
    "it is featured, if it is (`featured`; `latest` and `following` mark features too).",
  kind: "read",
  input: z.object({ scope: z.enum([...FEED_SCOPES, "top"]).default("latest"), ...pageInput }),
  output: Page(FeedItem),
});

export const feedNewCount = defineContract({
  name: "feed.newCount",
  summary:
    "How many entries of the feed are newer than `since`, for a client that polls to offer " +
    '"N new posts". `since` is the `createdAt` of the newest entry the client shows. ' +
    "`scope` is `latest` or `following` (which requires an account); `hot` is recomputed " +
    "every few minutes and has nothing to poll. The entries are those `feed.list` would put " +
    "above `since` for this viewer, with the same filters (forums the viewer may open, wall " +
    "posts they may see, ignored members), counted through the same walks but never built: a " +
    "thread that gets a reply counts again, as it moves to the top, and the viewer's own posts " +
    "count too. A post approved after newer ones were posted keeps its old time and is not " +
    "counted, nor is an entry made in the very millisecond of `since`. `count` is at most 99 and `more` is true when there are more than that. A " +
    "hundred hidden entries in a row may make the count too low.",
  kind: "read",
  input: z.object({ scope: z.enum(["latest", "following"]).default("latest"), since: Timestamp }),
  output: z.object({ count: z.number().int().min(0).max(99), more: z.boolean() }),
});

export const THREAD_RANKINGS = [
  "latestPosts",
  "latestThreads",
  "mostReplied",
  "mostReacted",
  "mostViewed",
] as const;

export const threadsRanked = defineContract({
  name: "threads.ranked",
  summary:
    "Threads across every forum the viewer can see, ranked one way: `latestPosts` (newest " +
    "activity), `latestThreads` (newest threads), or the most replied-to, most reacted-to " +
    '(reactions on the opening post) and most viewed threads. The three "most" rankings are ' +
    "recomputed in the background every few minutes, per forum, from threads active in the last " +
    "30 days; what a viewer gets is the best of the forums they can see, without threads of " +
    "members the viewer ignores (the two latest rankings do not apply ignores).",
  kind: "read",
  input: z.object({
    by: z.enum(THREAD_RANKINGS),
    limit: z.number().int().min(1).max(20).default(10),
  }),
  output: z.object({ items: z.array(Thread) }),
});

export const FeaturedThread = z
  .object({
    kind: FeatureKind,
    /** When the feature began. */
    startedAt: Timestamp,
    /** When it ends; null for a staff pick, which lasts until a moderator ends it. */
    endsAt: Timestamp.nullable(),
    thread: Thread,
  })
  .meta({ id: "FeaturedThread" });

export const threadsFeatured = defineContract({
  name: "threads.featured",
  summary:
    "The threads featured right now (staff picks, and paid promotions until their 24 hours " +
    "end), newest feature first, limited to threads the viewer may open (same rules as the " +
    "hot feed: forums the viewer can see, visible threads, authors the viewer does not ignore). " +
    "For the home page. Public.",
  kind: "read",
  input: z.object({ limit: z.number().int().min(1).max(20).default(3) }),
  output: z.object({ items: z.array(FeaturedThread) }),
});

export const threadsByAuthor = defineContract({
  name: "threads.byAuthor",
  summary:
    "The threads a member started, newest first, limited to what the viewer may open. " +
    "Requires profile.view; a member whose profile the viewer cannot see is not found.",
  kind: "read",
  input: z.object({ userId: Id, ...pageInput }),
  output: Page(Thread),
});

export const postsByAuthor = defineContract({
  name: "posts.byAuthor",
  summary:
    "The posts a member wrote, newest first, each with its thread, limited to what the viewer " +
    "may open. Requires profile.view; a member whose profile the viewer cannot see is not found.",
  kind: "read",
  input: z.object({ userId: Id, ...pageInput }),
  output: Page(PostInThread),
});
