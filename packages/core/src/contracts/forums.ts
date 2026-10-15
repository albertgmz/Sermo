import * as z from "zod";
import { FEATURE_KINDS, NODE_TYPES, NODE_WATCH_MODES } from "../db/schema";
import { defineContract } from "../operation";
import { Attachment, AttachmentIds } from "./attachments";
import {
  ActorPassword,
  Body,
  ContentState,
  Empty,
  IconKey,
  Id,
  moderationNotice,
  Ok,
  Page,
  pageInput,
  ReactionSummary,
  ResolvedPermissions,
  Timestamp,
  Title,
  UserSummary,
} from "./common";
import { ImageReference } from "./images";
import { SeoMetadata } from "./seo";

export const NodeType = z.enum(NODE_TYPES);

/** Why a thread is featured: `staff` (a moderator picked it) or `paid` (its author paid for 24 hours). */
export const FeatureKind = z.enum(FEATURE_KINDS).meta({ id: "FeatureKind" });

/** The prefix shown in front of a thread title. */
export const ThreadPrefixTag = z
  .object({
    id: Id,
    label: z.string(),
    /** #rrggbb, from the prefix colour catalog. */
    color: z.string(),
    /** An icon key the client resolves; may be empty. */
    icon: z.string(),
  })
  .meta({ id: "ThreadPrefixTag" });

export const ThreadPrefix = ThreadPrefixTag.extend({
  colorId: Id,
  position: z.number().int(),
  isActive: z.boolean(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
}).meta({ id: "ThreadPrefix" });

export const ForumTab = z
  .object({
    id: Id,
    title: z.string(),
    position: z.number().int(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: "ForumTab" });

/** Posting rules of a node; forum.bypassNodeRules exempts moderators. */
export const NodeSettings = z
  .object({
    /** New threads wait for approval. */
    requireThreadApproval: z.boolean(),
    /** New replies wait for approval. */
    requireReplyApproval: z.boolean(),
    /** Nobody can start threads or reply. */
    isReadOnly: z.boolean(),
    /** Minimum account age in days to post here. */
    minAccountAgeDays: z.number().int().min(0).max(3650),
    /** Minimum post count to post here. */
    minPostCount: z.number().int().min(0).max(1_000_000),
  })
  .meta({ id: "NodeSettings" });

export const Node = z
  .object({
    id: Id,
    parentId: Id.nullable(),
    type: NodeType,
    title: z.string(),
    description: z.string(),
    icon: ImageReference,
    /**
     * The icon from the site's icon set, drawn as a glyph before the title; null for none. The
     * uploaded `icon` and `cover` pictures are separate and do not replace it.
     */
    iconKey: IconKey.nullable(),
    cover: ImageReference,
    position: z.number().int(),
    /** The forum list tab of this node's root category; null when that category has none. */
    tabId: Id.nullable(),
    /** Depth in the tree; root nodes are 0. */
    depth: z.number().int().nonnegative(),
    /** Visible threads directly in this node. */
    threadCount: z.number().int().nonnegative(),
    /** Visible posts directly in this node. */
    postCount: z.number().int().nonnegative(),
    lastPost: z
      .object({
        postId: Id,
        threadId: Id,
        threadTitle: z.string(),
        postedAt: Timestamp,
        user: UserSummary,
      })
      .nullable(),
    /** What the viewer may do here. */
    permissions: z.object({ canPost: z.boolean(), canModerate: z.boolean() }),
    settings: NodeSettings,
  })
  .meta({ id: "Node" });

export const Thread = z
  .object({
    id: Id,
    nodeId: Id,
    /** The forum the thread is in. */
    node: z.object({ id: Id, title: z.string() }),
    title: z.string(),
    prefix: ThreadPrefixTag.nullable(),
    /** Plain-text start of the opening post. */
    excerpt: z.string(),
    /** The thread's cover from the catalog, or null. */
    cover: ImageReference,
    /** Lists show the thread highlighted until then; null or past means not highlighted. */
    highlightedUntil: Timestamp.nullable(),
    /** When the author last bumped it; a bump sorts like a new post. */
    bumpedAt: Timestamp.nullable(),
    author: UserSummary,
    state: ContentState,
    isSticky: z.boolean(),
    isLocked: z.boolean(),
    createdAt: Timestamp,
    replyCount: z.number().int().nonnegative(),
    /** Stored views plus views still buffered in memory. */
    viewCount: z.number().int().nonnegative(),
    firstPostId: Id,
    /**
     * Newest visible post. `floor(position / limit) + 1` is the number of pages a member sees;
     * moderators (and authors of later unapproved posts) follow `nextCursor` past it.
     */
    lastPost: z.object({
      postId: Id,
      position: z.number().int().nonnegative(),
      postedAt: Timestamp,
      user: UserSummary,
    }),
    /** Position of the newest post the viewer marked read, or null if never read / guest. */
    readPosition: z.number().int().nonnegative().nullable(),
    /**
     * Signed-in viewers only: the thread's last post is newer than the newest post the viewer
     * has read, and the last post is less than 30 days old (older activity counts as read).
     */
    isUnread: z.boolean(),
  })
  .meta({ id: "Thread" });

export const Post = z
  .object({
    id: Id,
    threadId: Id,
    /**
     * 0-based position in the thread in creation order; it never changes. Page n holds positions
     * [(n-1)*limit, n*limit). Posts the viewer may not see leave gaps in that range.
     */
    position: z.number().int().nonnegative(),
    author: UserSummary,
    state: ContentState,
    createdAt: Timestamp,
    editedAt: Timestamp.nullable(),
    bodyHtml: z.string(),
    attachmentCount: z.number().int().nonnegative(),
    attachments: z.array(Attachment),
    reactions: ReactionSummary,
    canEdit: z.boolean(),
    canDelete: z.boolean(),
    /** The viewer may report it (reports.create would accept it). */
    canReport: z.boolean(),
  })
  .meta({ id: "Post" });

export const PostDetail = Post.extend({ bodySource: z.string() }).meta({ id: "PostDetail" });

// Nodes --------------------------------------------------------------------

export const nodesList = defineContract({
  name: "nodes.list",
  summary: "The node tree the viewer can see, flattened in depth-first display order.",
  kind: "read",
  input: Empty,
  output: z.object({ items: z.array(Node) }),
});

export const nodesGet = defineContract({
  name: "nodes.get",
  summary:
    "One node, with breadcrumbs from the root. For a signed-in viewer, `watching` says whether " +
    "they watch this forum and how (null when they do not, for guests and for categories).",
  kind: "read",
  input: z.object({ nodeId: Id }),
  output: z.object({
    node: Node,
    watching: z.object({ mode: z.enum(NODE_WATCH_MODES), email: z.boolean() }).nullable(),
    seo: SeoMetadata,
    breadcrumbs: z.array(z.object({ id: Id, title: z.string(), type: NodeType })),
    /** The viewer's node permissions here. */
    resolvedPermissions: ResolvedPermissions,
  }),
});

export const nodesCreate = defineContract({
  name: "nodes.create",
  summary: "Create a category or forum. Admins only. Categories cannot hold threads.",
  kind: "write",
  input: z.object({
    parentId: Id.nullable(),
    type: NodeType,
    title: z.string().trim().min(1).max(100),
    description: z.string().trim().max(2000).default(""),
    position: z.number().int().default(0),
    /** A root category's forum list tab. Refused on any other node. */
    tabId: Id.nullable().optional(),
    /** A key of the site's icon set; null for none. */
    iconKey: IconKey.nullable().optional(),
    settings: NodeSettings.partial().optional(),
  }),
  output: Node,
});

export const nodesUpdate = defineContract({
  name: "nodes.update",
  summary: "Rename, describe, reorder or re-parent a node. Admins only. Cycles are rejected.",
  kind: "write",
  input: z.object({
    nodeId: Id,
    parentId: Id.nullable().optional(),
    title: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(2000).optional(),
    position: z.number().int().optional(),
    /** A root category's forum list tab; null removes it. Refused on any other node. */
    tabId: Id.nullable().optional(),
    /** A key of the site's icon set; null removes it. */
    iconKey: IconKey.nullable().optional(),
    settings: NodeSettings.partial().optional(),
  }),
  output: Node,
});

// Forum list tabs ----------------------------------------------------------

export const forumTabsList = defineContract({
  name: "forumTabs.list",
  summary: "The tabs of the forum list in display order (position, then id). Open to everyone.",
  kind: "read",
  input: Empty,
  output: z.object({ items: z.array(ForumTab) }),
});

export const forumTabsCreate = defineContract({
  name: "forumTabs.create",
  summary: "Add a forum list tab (at most 20). Requires admin.nodes.",
  kind: "write",
  input: z.object({
    title: z.string().trim().min(1).max(60),
    position: z.number().int().min(0).max(1_000_000).default(0),
  }),
  output: ForumTab,
});

export const forumTabsUpdate = defineContract({
  name: "forumTabs.update",
  summary: "Rename or reorder a forum list tab. Requires admin.nodes.",
  kind: "write",
  input: z.object({
    tabId: Id,
    title: z.string().trim().min(1).max(60).optional(),
    position: z.number().int().min(0).max(1_000_000).optional(),
  }),
  output: ForumTab,
});

export const forumTabsDelete = defineContract({
  name: "forumTabs.delete",
  summary:
    "Delete a forum list tab. Its categories stay and belong to no tab. Requires admin.nodes.",
  kind: "write",
  input: z.object({ tabId: Id }),
  output: Ok,
});

// Thread prefixes ----------------------------------------------------------

const PrefixInput = {
  label: z.string().trim().min(1).max(30),
  /** An active colour of the `prefix` catalog. */
  colorId: Id,
  icon: z.string().trim().max(60),
  position: z.number().int().min(0).max(1_000_000),
  isActive: z.boolean(),
};

export const threadPrefixesList = defineContract({
  name: "threadPrefixes.list",
  summary:
    "Thread prefixes in display order (position, then id). Open to everyone; inactive ones " +
    "only with admin.nodes.",
  kind: "read",
  input: Empty,
  output: z.object({ items: z.array(ThreadPrefix) }),
});

export const threadPrefixesCreate = defineContract({
  name: "threadPrefixes.create",
  summary: "Add a thread prefix (at most 100). Requires admin.nodes.",
  kind: "write",
  input: z.object({
    ...PrefixInput,
    icon: PrefixInput.icon.default(""),
    position: PrefixInput.position.default(0),
    isActive: PrefixInput.isActive.default(true),
  }),
  output: ThreadPrefix,
});

export const threadPrefixesUpdate = defineContract({
  name: "threadPrefixes.update",
  summary:
    "Change a thread prefix; threads that carry it show the change at once. Requires admin.nodes.",
  kind: "write",
  input: z.object({
    prefixId: Id,
    label: PrefixInput.label.optional(),
    colorId: PrefixInput.colorId.optional(),
    icon: PrefixInput.icon.optional(),
    position: PrefixInput.position.optional(),
    isActive: PrefixInput.isActive.optional(),
  }),
  output: ThreadPrefix,
});

export const threadPrefixesDelete = defineContract({
  name: "threadPrefixes.delete",
  summary:
    "Remove a thread prefix. While a thread carries it, it is deactivated instead " +
    "(`deactivated: true`): those threads keep it and no thread can newly take it. Requires " +
    "admin.nodes.",
  kind: "write",
  input: z.object({ prefixId: Id }),
  output: z.object({ ok: z.literal(true), deactivated: z.boolean() }),
});

// Threads ------------------------------------------------------------------

export const threadsList = defineContract({
  name: "threads.list",
  summary:
    "Threads in a forum, newest activity first (the later of the last post and the last bump). " +
    "Sticky threads are returned separately in `sticky` on the first page only (when no cursor " +
    "is given). With `prefixId`, only the threads carrying that prefix.",
  kind: "read",
  input: z.object({ nodeId: Id, prefixId: Id.optional(), ...pageInput }),
  output: Page(Thread).extend({ sticky: z.array(Thread) }),
});

export const threadsGet = defineContract({
  name: "threads.get",
  summary:
    "One thread. Counts a view (buffered; never writes during the read) unless `countView` is " +
    "false, which edit and moderation pages send. For a signed-in viewer, `watching` says " +
    "whether they watch the thread (null when they do not and for guests). `featured` is why " +
    "the thread is featured right now, or null (a staff pick wins over a paid promotion).",
  kind: "read",
  input: z.object({ threadId: Id, countView: z.boolean().default(true) }),
  output: z.object({
    thread: Thread,
    featured: FeatureKind.nullable(),
    seo: SeoMetadata,
    node: z.object({ id: Id, title: z.string() }),
    watching: z.object({ email: z.boolean() }).nullable(),
    permissions: z.object({
      canReply: z.boolean(),
      canEditTitle: z.boolean(),
      canModerate: z.boolean(),
      /** The viewer may report the thread (its first post). */
      canReport: z.boolean(),
      /** The viewer may remove the thread's cover (threads.removeCover would accept it). */
      canRemoveCover: z.boolean(),
      /** The viewer may watch the thread. */
      canWatch: z.boolean(),
    }),
    /** The viewer's node permissions in the thread's node. */
    resolvedPermissions: ResolvedPermissions,
  }),
});

export const threadsCreate = defineContract({
  name: "threads.create",
  summary: "Start a thread in a forum, optionally with an active prefix.",
  kind: "write",
  input: z.object({
    nodeId: Id,
    title: Title,
    body: Body,
    attachmentIds: AttachmentIds,
    prefixId: Id.nullable().default(null),
  }),
  output: z.object({ thread: Thread, post: PostDetail }),
});

export const threadsUpdate = defineContract({
  name: "threads.update",
  summary:
    "Change a thread's title, its prefix, or both (`prefixId: null` removes the prefix; a new " +
    "prefix must be active). Author (while unlocked) or moderator.",
  kind: "write",
  input: z.object({
    ...moderationNotice,
    threadId: Id,
    title: Title.optional(),
    prefixId: Id.nullable().optional(),
  }),
  output: Thread,
});

export const threadsSetSticky = defineContract({
  name: "threads.setSticky",
  summary: "Stick or unstick a thread. Moderators only.",
  kind: "write",
  input: z.object({ ...moderationNotice, threadId: Id, isSticky: z.boolean() }),
  output: Thread,
});

export const threadsSetFeatured = defineContract({
  name: "threads.setFeatured",
  summary:
    "Feature or unfeature a thread as a staff pick. A pick lasts until a moderator unfeatures " +
    "it. The 10 newest features are listed first in Hot whatever their activity; an older one " +
    "is listed there only where it ranks; `threads.featured` (the home page) lists every current " +
    "feature, newest first. Requires " +
    "forum.feature in the thread's forum. Only a visible thread can be featured (a conflict " +
    "otherwise). Asking for the state the thread already has changes and logs nothing. A paid " +
    "promotion is not touched: it runs to its end, and a staff pick may be added while one " +
    "runs. Logged in the moderator log as `thread.feature` (`details.isFeatured`) with the reason; the author is not notified.",
  kind: "write",
  input: z.object({ threadId: Id, isFeatured: z.boolean(), reason: moderationNotice.reason }),
  output: Thread,
});

export const threadsSetLocked = defineContract({
  name: "threads.setLocked",
  summary: "Lock or unlock a thread. Moderators only.",
  kind: "write",
  input: z.object({ ...moderationNotice, threadId: Id, isLocked: z.boolean() }),
  output: Thread,
});

export const threadsMove = defineContract({
  name: "threads.move",
  summary: "Move a thread to another forum. Moderator of both source and target.",
  kind: "write",
  input: z.object({ ...moderationNotice, threadId: Id, nodeId: Id }),
  output: Thread,
});

export const threadsDelete = defineContract({
  name: "threads.delete",
  summary: "Soft-delete a thread. Moderators only.",
  kind: "write",
  input: z.object({ ...moderationNotice, threadId: Id }),
  output: Thread,
});

export const threadsRestore = defineContract({
  name: "threads.restore",
  summary: "Make a deleted or unapproved thread visible again. Moderators only.",
  kind: "write",
  input: z.object({ ...moderationNotice, threadId: Id }),
  output: Thread,
});

export const threadsRemoveCover = defineContract({
  name: "threads.removeCover",
  summary:
    "Take the cover off a thread. The author of a visible thread, or anyone who may edit other " +
    "members' threads there. Nothing is refunded.",
  kind: "write",
  input: z.object({ ...moderationNotice, threadId: Id }),
  output: Thread,
});

export const threadsMarkRead = defineContract({
  name: "threads.markRead",
  summary:
    "Record that the viewer has read the thread up to the post at `position` (clamped to the " +
    "last visible post). Never moves backwards. Signed-in only.",
  kind: "write",
  input: z.object({ threadId: Id, position: z.number().int().nonnegative() }),
  output: z.object({ readPosition: z.number().int().nonnegative() }),
});

// Posts --------------------------------------------------------------------

export const postsList = defineContract({
  name: "posts.list",
  summary:
    "One page of a thread's posts: positions [(page-1)*limit, page*limit), in position order. " +
    "`cursor` (from the previous page) takes precedence over `page`. Posts the viewer may not " +
    "see are left out, so a page can hold fewer than `limit` posts (moderators see every " +
    "state; authors also see their own unapproved posts). `nextCursor` is null after the last " +
    "page. `afterPosition` (the highest position the client holds) starts the page at the " +
    "position after it, so a client can poll for replies: the answer is empty when there is " +
    "nothing new. A `cursor` takes precedence over it, and it over `page`. With " +
    "`afterPosition` the answer also carries `afterPostId`, the id of the post now at that " +
    "position (null when there is none, or when the viewer may not see it, as with the items). " +
    "Merging threads into this one renumbers positions, so the rule for a poller is: when " +
    "`afterPostId` is not the id of the newest post it holds, drop what it holds and reload " +
    "the thread from the start, ignoring the items of that answer; otherwise append the " +
    "items. For a merge the check is exact: posts merged in below the held ones change the " +
    "id at that position, while posts merged in above it and replies do not. A split does " +
    "not renumber the posts that stay; it changes the id at that position only when the held " +
    "newest post itself is split out, and a post that turns hidden for the viewer gives " +
    "null. A poll does not show edits, removals or splits of other posts the client already " +
    "holds, nor a post approved after newer ones were posted (it keeps its old position): " +
    "those show on the next reload. While a merge into the thread " +
    "is running, each answer costs a pass over the posts of the thread and its sources " +
    "instead of an index read.",
  kind: "read",
  input: z.object({
    threadId: Id,
    page: z.number().int().min(1).optional(),
    afterPosition: z.number().int().nonnegative().optional(),
    ...pageInput,
  }),
  output: Page(Post).extend({
    /** Only with `afterPosition`: the id of the post at that position now, or null. */
    afterPostId: Id.nullable().optional(),
  }),
});

export const postsGet = defineContract({
  name: "posts.get",
  summary: "One post with its Markdown source.",
  kind: "read",
  input: z.object({ postId: Id }),
  output: PostDetail,
});

export const postsCreate = defineContract({
  name: "posts.create",
  summary: "Reply to a thread. Locked threads accept replies from moderators only.",
  kind: "write",
  input: z.object({ threadId: Id, body: Body, attachmentIds: AttachmentIds }),
  output: PostDetail,
});

export const postsUpdate = defineContract({
  name: "posts.update",
  summary: "Edit a post. Author (while the thread is unlocked) or moderator.",
  kind: "write",
  input: z.object({ ...moderationNotice, postId: Id, body: Body, attachmentIds: AttachmentIds }),
  output: PostDetail,
});

export const postsDelete = defineContract({
  name: "posts.delete",
  summary:
    "Soft-delete a post. Author (while unlocked) or moderator. The first post cannot be " +
    "deleted on its own; delete the thread instead.",
  kind: "write",
  input: z.object({ ...moderationNotice, postId: Id }),
  output: Post,
});

export const postsRestore = defineContract({
  name: "posts.restore",
  summary: "Make a deleted or unapproved post visible again. Moderators only.",
  kind: "write",
  input: z.object({ ...moderationNotice, postId: Id }),
  output: Post,
});

// Thread merge and split, node moderators -------------------------------------------------------

export const threadsMerge = defineContract({
  name: "threads.merge",
  summary:
    "Merge threads into a target thread: the target's first post stays first and the other " +
    "posts are ordered by creation time; each merged thread's id keeps resolving to the target. Requires forum.merge on the " +
    "target's node and on each source's node. Very large merges finish in the background.",
  kind: "write",
  input: z.object({
    ...moderationNotice,
    threadId: Id.describe("The target thread."),
    sourceThreadIds: z.array(Id).min(1).max(10),
  }),
  output: z.object({ thread: Thread, completed: z.boolean() }),
});

export const threadsSplit = defineContract({
  name: "threads.split",
  summary:
    "Move posts (given ids, or every post from a position on) into a new thread in a forum. The " +
    "first post cannot move. Requires forum.split on the source and destination nodes. Very " +
    "large splits finish in the background.",
  kind: "write",
  input: z.object({
    ...moderationNotice,
    threadId: Id,
    postIds: z.array(Id).min(1).max(500).optional(),
    fromPosition: z.number().int().min(1).optional(),
    title: Title,
    nodeId: Id,
  }),
  output: z.object({ thread: Thread, completed: z.boolean() }),
});

export const nodesSetModerator = defineContract({
  name: "nodes.setModerator",
  summary:
    "Make a member moderator of a node and everything under it (member-specific entries for the " +
    "standard moderator set), or remove that. Requires admin.permissions. `actorPassword` is " +
    "the acting administrator's own password: it is verified under the same wrong-answer " +
    "limit as users.adminUpdateIdentity, and a wrong one changes nothing. A browser session " +
    "(session cookie) must send it (missing: a validation error naming actorPassword). An API " +
    "key or token cannot make this change: it is refused whether or not it sends a password.",
  kind: "write",
  input: z.object({
    nodeId: Id,
    userId: Id,
    remove: z.boolean().default(false),
    actorPassword: ActorPassword.optional(),
  }),
  output: Ok,
});
