import * as z from "zod";
import { defineContract } from "../operation";
import { Id, Page, pageInput, Timestamp } from "./common";
import { Post, Thread } from "./forums";
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
 * the newest reply). `profilePost` is a post on a member's wall, with its latest comments.
 * `following` says whether the viewer follows the author of the post shown (always false for
 * guests). `canReply` says whether `posts.create` would accept a reply from the viewer in that
 * thread, by the rule of `threads.get`; a wall post says the same in `profilePost.canComment`.
 */
export const FeedItem = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("thread"),
      createdAt: Timestamp,
      following: z.boolean(),
      canReply: z.boolean(),
      thread: Thread,
      post: Post,
    }),
    z.object({
      type: z.literal("post"),
      createdAt: Timestamp,
      following: z.boolean(),
      canReply: z.boolean(),
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

export const FEED_SCOPES = ["latest", "following", "top"] as const;

export const feedList = defineContract({
  name: "feed.list",
  summary:
    "The feed of conversations, newest first: threads and wall posts the viewer may open. " +
    "`latest` is everyone's activity, one entry per thread: a thread is listed once, at its " +
    "newest visible post (its opening post, or its newest reply), and never again on a later " +
    "page; a new reply moves it to the top. A thread whose newest post is by a member the " +
    "viewer ignores is left out. `following` is the activity of the members the viewer " +
    "follows (the 100 followed most recently, when there are more) and requires an account: a " +
    "thread is listed at the newest post one of them wrote in it, once per answer; a later " +
    "page may list the same thread again, with an older post of a followed member. " +
    "`top` is the most reacted-to thread posts of the last seven days among the forums the " +
    "viewer can see, at most 50, recomputed every few minutes and not paginated (`nextCursor` is " +
    "always null); it ranks posts, so a thread can appear there more than once. Content hidden since the last refresh is left out and replaced by the next " +
    "best, as far as the stored ranking reaches. Content of ignored members is left out. A " +
    "thread entry says whether the viewer may reply to it (`canReply`).",
  kind: "read",
  input: z.object({ scope: z.enum(FEED_SCOPES).default("latest"), ...pageInput }),
  output: Page(FeedItem),
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
