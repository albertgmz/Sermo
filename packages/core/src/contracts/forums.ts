import * as z from "zod";
import { NODE_TYPES } from "../db/schema";
import { defineContract } from "../operation";
import {
  Body,
  ContentState,
  Empty,
  Id,
  Page,
  pageInput,
  ReactionSummary,
  Timestamp,
  Title,
  UserSummary,
} from "./common";

export const NodeType = z.enum(NODE_TYPES);

export const Node = z
  .object({
    id: Id,
    parentId: Id.nullable(),
    type: NodeType,
    title: z.string(),
    description: z.string(),
    position: z.number().int(),
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
  })
  .meta({ id: "Node" });

export const Thread = z
  .object({
    id: Id,
    nodeId: Id,
    title: z.string(),
    author: UserSummary,
    state: ContentState,
    isSticky: z.boolean(),
    isLocked: z.boolean(),
    createdAt: Timestamp,
    replyCount: z.number().int().nonnegative(),
    /** Stored views plus views still buffered in memory. */
    viewCount: z.number().int().nonnegative(),
    firstPostId: Id,
    lastPost: z.object({ postId: Id, postedAt: Timestamp, user: UserSummary }),
    /**
     * Position of the newest post the viewer marked read (a jump target; approximate after
     * deletions), or null if never read / guest.
     */
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
     * 0-based position among visible posts; page n holds positions [(n-1)*limit, n*limit).
     * A hidden post keeps its position, so it shares it with the next visible post.
     */
    position: z.number().int().nonnegative(),
    author: UserSummary,
    state: ContentState,
    createdAt: Timestamp,
    editedAt: Timestamp.nullable(),
    bodyHtml: z.string(),
    reactions: ReactionSummary,
    canEdit: z.boolean(),
    canDelete: z.boolean(),
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
  summary: "One node, with breadcrumbs from the root.",
  kind: "read",
  input: z.object({ nodeId: Id }),
  output: z.object({
    node: Node,
    breadcrumbs: z.array(z.object({ id: Id, title: z.string(), type: NodeType })),
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
  }),
  output: Node,
});

// Threads ------------------------------------------------------------------

export const threadsList = defineContract({
  name: "threads.list",
  summary:
    "Threads in a forum, newest activity first. Sticky threads are returned separately in " +
    "`sticky` on the first page only (when no cursor is given).",
  kind: "read",
  input: z.object({ nodeId: Id, ...pageInput }),
  output: Page(Thread).extend({ sticky: z.array(Thread) }),
});

export const threadsGet = defineContract({
  name: "threads.get",
  summary: "One thread. Counts a view (buffered; never writes during the read).",
  kind: "read",
  input: z.object({ threadId: Id }),
  output: z.object({
    thread: Thread,
    node: z.object({ id: Id, title: z.string() }),
    permissions: z.object({
      canReply: z.boolean(),
      canEditTitle: z.boolean(),
      canModerate: z.boolean(),
    }),
  }),
});

export const threadsCreate = defineContract({
  name: "threads.create",
  summary: "Start a thread in a forum.",
  kind: "write",
  input: z.object({ nodeId: Id, title: Title, body: Body }),
  output: z.object({ thread: Thread, post: PostDetail }),
});

export const threadsUpdate = defineContract({
  name: "threads.update",
  summary: "Change a thread's title. Author (while unlocked) or moderator.",
  kind: "write",
  input: z.object({ threadId: Id, title: Title }),
  output: Thread,
});

export const threadsSetSticky = defineContract({
  name: "threads.setSticky",
  summary: "Stick or unstick a thread. Moderators only.",
  kind: "write",
  input: z.object({ threadId: Id, isSticky: z.boolean() }),
  output: Thread,
});

export const threadsSetLocked = defineContract({
  name: "threads.setLocked",
  summary: "Lock or unlock a thread. Moderators only.",
  kind: "write",
  input: z.object({ threadId: Id, isLocked: z.boolean() }),
  output: Thread,
});

export const threadsMove = defineContract({
  name: "threads.move",
  summary: "Move a thread to another forum. Moderator of both source and target.",
  kind: "write",
  input: z.object({ threadId: Id, nodeId: Id }),
  output: Thread,
});

export const threadsDelete = defineContract({
  name: "threads.delete",
  summary: "Soft-delete a thread. Moderators only.",
  kind: "write",
  input: z.object({ threadId: Id }),
  output: Thread,
});

export const threadsRestore = defineContract({
  name: "threads.restore",
  summary: "Make a deleted or unapproved thread visible again. Moderators only.",
  kind: "write",
  input: z.object({ threadId: Id }),
  output: Thread,
});

export const threadsMarkRead = defineContract({
  name: "threads.markRead",
  summary:
    "Record that the viewer has read the thread up to the visible post at `position` (clamped " +
    "to the last post). Never moves backwards. Signed-in only.",
  kind: "write",
  input: z.object({ threadId: Id, position: z.number().int().nonnegative() }),
  output: z.object({ readPosition: z.number().int().nonnegative() }),
});

// Posts --------------------------------------------------------------------

export const postsList = defineContract({
  name: "posts.list",
  summary:
    "Posts of a thread ordered by (position, id), at most `limit` per call. `page` (1-based) " +
    "starts at position (page-1)*limit; `cursor` continues after the last post of the previous " +
    "call and takes precedence over `page`. Moderators also receive hidden posts (and authors " +
    "their own unapproved ones), so their pages can end before the page's last position; " +
    "`nextCursor` continues from there.",
  kind: "read",
  input: z.object({ threadId: Id, page: z.number().int().min(1).optional(), ...pageInput }),
  output: Page(Post),
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
  input: z.object({ threadId: Id, body: Body }),
  output: PostDetail,
});

export const postsUpdate = defineContract({
  name: "posts.update",
  summary: "Edit a post. Author (while the thread is unlocked) or moderator.",
  kind: "write",
  input: z.object({ postId: Id, body: Body }),
  output: PostDetail,
});

export const postsDelete = defineContract({
  name: "posts.delete",
  summary:
    "Soft-delete a post. Author (while unlocked) or moderator. The first post cannot be " +
    "deleted on its own; delete the thread instead.",
  kind: "write",
  input: z.object({ postId: Id }),
  output: Post,
});

export const postsRestore = defineContract({
  name: "posts.restore",
  summary: "Make a deleted or unapproved post visible again. Moderators only.",
  kind: "write",
  input: z.object({ postId: Id }),
  output: Post,
});
