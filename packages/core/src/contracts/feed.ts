import * as z from "zod";
import { defineContract } from "../operation";
import { Attachment } from "./attachments";
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

/** The most unread posts a card counts. */
export const FEED_UNREAD_CAP = 99;

/**
 * What a signed-in viewer has not read of a thread, for the card: how many visible posts follow
 * the last one they read (posts awaiting approval or deleted are not counted, for staff too;
 * `count` is at most 99 and `more` says there are more than that), and the first of them
 * (`firstPostId`, at `firstPosition`, which gives its page), where "jump to first unread" lands.
 * Posts of members in a block with the viewer do not count, as the thread leaves them out.
 */
export const FeedUnread = z
  .object({
    count: z.number().int().min(1).max(FEED_UNREAD_CAP),
    more: z.boolean(),
    firstPostId: Id,
    firstPosition: z.number().int().nonnegative(),
  })
  .meta({ id: "FeedUnread" });

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
 * (`staff`, `paid`) or null, for the card's mark. `unread` is null for guests, for a thread the
 * viewer has read (or that is older than the 30 days a thread can count as unread) and where
 * the posts are closed to the viewer (a titles-only forum): no count and no position there.
 */
export const FeedItem = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("thread"),
      createdAt: Timestamp,
      following: z.boolean(),
      canReply: z.boolean(),
      featured: FeatureKind.nullable(),
      unread: FeedUnread.nullable(),
      thread: Thread,
      post: Post,
    }),
    z.object({
      type: z.literal("post"),
      createdAt: Timestamp,
      following: z.boolean(),
      canReply: z.boolean(),
      featured: FeatureKind.nullable(),
      unread: FeedUnread.nullable(),
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

/** What a thread is, for the feed filter: featured (a staff pick or a paid promotion), sticky or locked. */
export const FEED_THREAD_TYPES = ["featured", "sticky", "locked"] as const;
/** Forums one filter may name (each also takes the forums under it). */
export const FEED_FILTER_FORUMS = 20;
/** Filters a member may keep saved. */
export const FEED_FILTER_LIMIT = 10;
/** Forums a member may keep out of their own feed. */
export const FEED_HIDDEN_LIMIT = 100;

/**
 * The fields that narrow the feed. Each one that is set must hold for an entry, and a filter
 * never shows what the viewer may not open. `forumIds`: threads in these forums or the forums
 * under them (at most 20 are named). `prefixId`: threads carrying that prefix. `type`: see
 * FEED_THREAD_TYPES (`featured` looks at the 200 newest features). `tag`: threads carrying the tag
 * (by name, or an alias of it), ordered as the tag's page is ordered: by the later of the last
 * post and the last bump, so a bumped thread rises above newer posts. `watched`: threads the
 * viewer watches (on the latest tab their 500 most recent watches; the other tabs check them
 * all). `unread`: threads with posts the viewer has not read, within the 30 days a thread can
 * count as unread. `watched` and `unread` need an account. Wall posts
 * belong to no forum, so with any field on (`false` is off) the feed holds threads only.
 * "People I follow" is the `following` scope, which takes the same fields (it lists a thread once
 * per answer by someone followed, so a later page may repeat a thread).
 */
export const feedFilterFields = {
  forumIds: z.array(Id).max(FEED_FILTER_FORUMS).optional(),
  prefixId: Id.optional(),
  type: z.enum(FEED_THREAD_TYPES).optional(),
  tag: z.string().trim().min(1).max(100).optional(),
  watched: z.boolean().optional(),
  unread: z.boolean().optional(),
};
export const FeedFilter = z.object(feedFilterFields).meta({ id: "FeedFilter" });

export const feedList = defineContract({
  name: "feed.list",
  summary:
    "The feed of conversations: threads and wall posts the viewer may open, newest first (`hot` " +
    "is the exception, best first). Forums the site leaves out of the feed (`settings.update`, " +
    "`feedExcludedForumIds`) and forums the viewer hides from their own (`feed.hideForum`) " +
    "are not listed, with their subforums; naming a hidden forum in `forumIds` lists it again, " +
    "a site-excluded one never. The filter fields (`forumIds`, `prefixId`, `type`, `tag`, " +
    "`watched`, `unread`) narrow every scope, can be combined, and never widen what the " +
    "viewer may open; with one on, only threads are listed, and a page can be short while " +
    "`nextCursor` is set. `watched` and `unread` need an account. " +
    "`latest` is everyone's activity, one entry per thread: the visible threads are walked by " +
    "their last activity and each is listed once, with its newest visible post (its opening " +
    "post, or its newest reply), merged with the wall posts by time. A reply moves its thread " +
    "to the top; while paging, a thread that gets a reply is not listed a second time further " +
    "down. A thread started by a member in a block with the viewer is left out, and one whose " +
    "newest post is by such a member is listed at the newest post of anyone else. " +
    "`following` is the activity of the members the viewer follows (the 100 followed most " +
    "recently, when there are more) and requires an account: a thread is listed at the newest " +
    "post one of them wrote in it, once per answer; a later page may list the same thread " +
    "again, with an older post of a followed member. A cursor belongs to the scope and " +
    "filter that issued it. " +
    "`hot` is the threads that are busy right now among the forums the viewer can see, at most " +
    "50, each as its opening post, best first; it is recomputed every five minutes and not " +
    "paginated (`nextCursor` is always null). A thread scores its replies, the reactions on its " +
    "opening post and its views, divided by its age (a gravity formula), and is not listed " +
    "before it has 3 replies or 3 reactions on its opening post. Threads hidden since the last " +
    "refresh are left out and replaced by the next best, as far as the stored ranking " +
    "reaches. Up to 10 featured threads (staff picks and paid promotions, see " +
    "`threads.featured`) come first, newest feature first, whatever their activity, then the " +
    "ranked threads without them, all within the same 50; they follow the same visibility rules. " +
    "A featured thread beyond the 10 is listed only where it ranks. Threads of members in a " +
    "block with the viewer are left out. A thread entry says whether the viewer may reply to " +
    "it (`canReply`), why it is featured, if it is (`featured`; `latest` and `following` mark " +
    "features too), and, for a " +
    "signed-in viewer who has unread posts in it, how many and where the first is (`unread`, read " +
    "from the viewer's read state for the whole page at once; none for a forum open for titles only).",
  kind: "read",
  input: z.object({
    scope: z.enum(FEED_SCOPES).default("latest"),
    ...feedFilterFields,
    ...pageInput,
  }),
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
    "posts they may see, blocks) and the same filter fields, counted through the same " +
    "walks but never built: a " +
    "thread that gets a reply counts again, as it moves to the top, and the viewer's own posts " +
    "count too. A post approved after newer ones were posted keeps its old time and is not " +
    "counted, nor is an entry made in the very millisecond of `since`. `count` is at most 99 and `more` is true when there are more than that. A " +
    "hundred hidden entries in a row may make the count too low.",
  kind: "read",
  input: z.object({
    scope: z.enum(["latest", "following"]).default("latest"),
    since: Timestamp,
    ...feedFilterFields,
  }),
  output: z.object({ count: z.number().int().min(0).max(99), more: z.boolean() }),
});

/** A filter a member saved: the tab it opens on and the fields that narrow it. */
export const SavedFeedFilter = z
  .object({
    id: Id,
    name: z.string(),
    scope: z.enum(FEED_SCOPES),
    filter: FeedFilter,
    createdAt: Timestamp,
  })
  .meta({ id: "SavedFeedFilter" });

export const feedOptions = defineContract({
  name: "feed.options",
  summary:
    "What a client needs to draw the feed's filters in one read: the forums the site leaves " +
    "out of the feed (`excludedForumIds`, a setting), and, for a signed-in member, the forums " +
    "they hide from their own feed (`hiddenForumIds`) and their saved filters, oldest first " +
    "(`filters`, at most `filterLimit`). Guests get the site's list and nothing else. A forum " +
    "listed here also stands for the forums under it. Public.",
  kind: "read",
  input: z.object({}),
  output: z.object({
    excludedForumIds: z.array(Id),
    hiddenForumIds: z.array(Id),
    filters: z.array(SavedFeedFilter),
    filterLimit: z.number().int(),
  }),
});

export const feedSaveFilter = defineContract({
  name: "feed.saveFilter",
  summary:
    "Save a feed filter under a name, for the signed-in member: the tab it opens on and the " +
    "filter fields. A name is one filter whatever its case (1 to 40 characters, trimmed): " +
    "saving it again replaces that filter. A member keeps at most 10 filters; a new name past " +
    "that is a conflict. Saving checks the shape only: a forum or prefix that later goes away " +
    "just lists nothing.",
  kind: "write",
  input: z.object({
    name: z.string().trim().min(1).max(40),
    scope: z.enum(FEED_SCOPES),
    filter: FeedFilter,
  }),
  output: SavedFeedFilter,
});

export const feedDeleteFilter = defineContract({
  name: "feed.deleteFilter",
  summary: "Delete one of the signed-in member's saved feed filters. Not found for anyone else's.",
  kind: "write",
  input: z.object({ filterId: Id }),
  output: z.object({ deleted: z.literal(true) }),
});

export const feedHideForum = defineContract({
  name: "feed.hideForum",
  summary:
    "Keep a forum (and the forums under it) out of the signed-in member's own feed, or put it " +
    "back (`hidden`). Needs a forum the member can see to hide it; showing it again always " +
    "works. At most 100 forums can be hidden. It changes the member's feed only: the forum " +
    "stays open and listed everywhere else.",
  kind: "write",
  input: z.object({ nodeId: Id, hidden: z.boolean() }),
  output: z.object({ hidden: z.boolean() }),
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
    "30 days; what a viewer gets is the best of the forums they can see. Every ranking leaves " +
    "out the threads of members in a block with the viewer.",
  kind: "read",
  input: z.object({
    by: z.enum(THREAD_RANKINGS),
    limit: z.number().int().min(1).max(20).default(10),
    /**
     * Rank what the home feed shows: the forums the site leaves out of the feed and the ones the
     * viewer hides from theirs are left out too. The home page's side blocks ask for it.
     */
    feed: z.boolean().default(false),
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
    "hot feed: forums the viewer can see, visible threads, authors in no block with the viewer), " +
    "less the forums the site leaves out of the feed and the ones the viewer hides from theirs. " +
    "For the home page. Public.",
  kind: "read",
  input: z.object({ limit: z.number().int().min(1).max(20).default(3) }),
  output: z.object({ items: z.array(FeaturedThread) }),
});

/**
 * The most items the numbered pages of a member's threads or posts hold, as XenForo's postings
 * tab (its maximumSearchResults): the newest ones the viewer may open.
 */
export const AUTHOR_PAGES_MAX = 500;

const authorPagesNote =
  "`page` (from 1; a `cursor` takes precedence over it) is the page of `limit` items at that " +
  "place in the list; with it, `total` is how many items the numbered pages hold, only those " +
  `the viewer may open (\`ceil(total / limit)\` pages), null without it. They hold at most the ` +
  `newest ${AUTHOR_PAGES_MAX}, and fewer where one request examined as many of the member's ` +
  "items as it may before finding that many; a cursor walks on past both. ";

export const threadsByAuthor = defineContract({
  name: "threads.byAuthor",
  summary:
    "The threads a member started, newest first, limited to what the viewer may open. " +
    authorPagesNote +
    "Requires profile.view; a member whose profile the viewer cannot see is not found.",
  kind: "read",
  input: z.object({ userId: Id, page: z.number().int().min(1).optional(), ...pageInput }),
  output: Page(Thread).extend({ total: z.number().int().nonnegative().nullable() }),
});

export const postsByAuthor = defineContract({
  name: "posts.byAuthor",
  summary:
    "The posts a member wrote, newest first, each with its thread, limited to what the viewer " +
    "may open. " +
    authorPagesNote +
    "Requires profile.view; a member whose profile the viewer cannot see is not found.",
  kind: "read",
  input: z.object({ userId: Id, page: z.number().int().min(1).optional(), ...pageInput }),
  output: Page(PostInThread).extend({ total: z.number().int().nonnegative().nullable() }),
});

/**
 * One picture of the media listing: an image attached to a post (`type: "post"`, in the thread
 * `threadId`, at `position`) or to a wall post (`type: "profilePost"`, on the wall of
 * `profileUserId`). `createdAt` is when the picture was attached.
 */
export const MediaItem = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("post"),
      id: Id,
      createdAt: Timestamp,
      file: Attachment,
      postId: Id,
      position: z.number().int().nonnegative(),
      threadId: Id,
      threadTitle: z.string(),
    }),
    z.object({
      type: z.literal("profilePost"),
      id: Id,
      createdAt: Timestamp,
      file: Attachment,
      profilePostId: Id,
      profileUserId: Id,
    }),
  ])
  .meta({ id: "MediaItem" });

export const mediaList = defineContract({
  name: "media.list",
  summary:
    "The newest pictures attached to posts and wall posts, newest attachment first, limited to " +
    "content the viewer may open: visible posts in visible threads of forums the viewer can " +
    "view, wall posts of profiles the viewer may see (which needs profile.view), and nothing " +
    "by members in a block with the viewer. Only images count (JPEG, PNG, WebP, GIF); files " +
    "attached to conversation messages are never listed. Open to everyone. The walk is " +
    "bounded: one " +
    "request examines at most 400 attachments, so a page can hold fewer than `limit` items " +
    "while `nextCursor` is still non-null; keep paging to continue.",
  kind: "read",
  input: z.object({ ...pageInput }),
  output: Page(MediaItem),
});
