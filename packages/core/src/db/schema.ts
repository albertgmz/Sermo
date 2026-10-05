/**
 * Database schema. Conventions:
 * - Every table has an INTEGER PRIMARY KEY `id` (rowid alias).
 * - Timestamps are integer milliseconds since the Unix epoch.
 * - Booleans are integers (0/1) mapped with `mode: "boolean"`.
 * - Denormalized pointer columns (`last_post_id`, `first_post_id`, ...) carry no foreign key,
 *   to avoid circular references; the services keep them consistent inside write transactions.
 * - `reaction_counts` is a JSON object keyed by reaction type id: {"1": 3, "4": 1}.
 * - Post bodies live in `post_bodies`; other content tables keep their bodies inline.
 * - The FTS5 table `search_fts` and its triggers live in a hand-written migration, not here.
 */
import {
  type AnySQLiteColumn,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { auth_user } from "./auth-schema";

export const CONTENT_STATES = ["visible", "moderated", "deleted"] as const;
export type ContentStateValue = (typeof CONTENT_STATES)[number];

export const NODE_TYPES = ["category", "forum"] as const;
export const PARTICIPANT_STATES = ["active", "left"] as const;
export const REACTION_CONTENT_TYPES = [
  "post",
  "profile_post",
  "profile_post_comment",
  "conversation_message",
] as const;
export type ReactionContentType = (typeof REACTION_CONTENT_TYPES)[number];
export const JOB_STATUSES = ["pending", "running", "done", "failed"] as const;

const bool = (name: string) => integer(name, { mode: "boolean" });
const counter = (name: string) => integer(name).notNull().default(0);
const state = () => text("state", { enum: CONTENT_STATES }).notNull().default("visible");
const reactionCounts = () => text("reaction_counts").notNull().default("{}");

// ---------------------------------------------------------------------------
// Users and groups

/** Fixed group ids created by the seed migration. */
export const GROUP_IDS = { guest: 1, member: 2, moderator: 3, admin: 4 } as const;

export const groups = sqliteTable("groups", {
  id: integer("id").primaryKey(),
  title: text("title").notNull(),
  isAdmin: bool("is_admin").notNull().default(false),
  isModerator: bool("is_moderator").notNull().default(false),
  /** Default node permissions; per-node overrides live in node_permissions. */
  canViewNodes: bool("can_view_nodes").notNull().default(true),
  canPost: bool("can_post").notNull().default(false),
  canViewProfiles: bool("can_view_profiles").notNull().default(true),
  canPostProfile: bool("can_post_profile").notNull().default(false),
  canStartConversations: bool("can_start_conversations").notNull().default(false),
  canReact: bool("can_react").notNull().default(false),
});

/**
 * Forum data about a user. Identity and credentials (email, password, sessions, API keys) belong
 * to Better Auth's tables (auth-schema.ts); `id` is the auth_user id, so auth upgrades never touch
 * forum data. A row is created when Better Auth creates the user.
 */
export const users = sqliteTable(
  "users",
  {
    id: integer("id")
      .primaryKey()
      .references(() => auth_user.id, { onDelete: "cascade" }),
    /** Display form of the username (Better Auth's displayUsername), used on every page. */
    username: text("username").notNull(),
    /** Lowercased username; unique, and used for prefix search. */
    usernameKey: text("username_key").notNull(),
    groupId: integer("group_id")
      .notNull()
      .references(() => groups.id),
    about: text("about").notNull().default(""),
    createdAt: integer("created_at").notNull(),
    postCount: counter("post_count"),
    reactionScore: counter("reaction_score"),
  },
  (t) => [uniqueIndex("users_username_key").on(t.usernameKey)],
);

// ---------------------------------------------------------------------------
// Node tree and permissions

export const nodes = sqliteTable(
  "nodes",
  {
    id: integer("id").primaryKey(),
    parentId: integer("parent_id").references((): AnySQLiteColumn => nodes.id),
    type: text("type", { enum: NODE_TYPES }).notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    position: integer("position").notNull().default(0),
    /** Visible threads directly in this node (not descendants). */
    threadCount: counter("thread_count"),
    /** Visible posts in visible threads directly in this node. */
    postCount: counter("post_count"),
    lastPostAt: integer("last_post_at"),
    lastPostId: integer("last_post_id"),
    lastThreadId: integer("last_thread_id"),
    lastThreadTitle: text("last_thread_title"),
    lastPosterId: integer("last_poster_id"),
  },
  (t) => [index("nodes_parent_position").on(t.parentId, t.position)],
);

/** Per-node, per-group overrides. Null means inherit from the parent node (or group default). */
export const nodePermissions = sqliteTable(
  "node_permissions",
  {
    id: integer("id").primaryKey(),
    nodeId: integer("node_id")
      .notNull()
      .references(() => nodes.id),
    groupId: integer("group_id")
      .notNull()
      .references(() => groups.id),
    canView: bool("can_view"),
    canPost: bool("can_post"),
    canModerate: bool("can_moderate"),
  },
  (t) => [uniqueIndex("node_permissions_node_group").on(t.nodeId, t.groupId)],
);

// ---------------------------------------------------------------------------
// Threads and posts

export const threads = sqliteTable(
  "threads",
  {
    id: integer("id").primaryKey(),
    nodeId: integer("node_id")
      .notNull()
      .references(() => nodes.id),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull(),
    state: state(),
    isSticky: bool("is_sticky").notNull().default(false),
    isLocked: bool("is_locked").notNull().default(false),
    createdAt: integer("created_at").notNull(),
    /** Visible posts minus one (the first post). */
    replyCount: counter("reply_count"),
    viewCount: counter("view_count"),
    /**
     * Null only between inserting the thread and inserting its first post, inside the same
     * transaction. The search trigger relies on this to index the title with the first post.
     */
    firstPostId: integer("first_post_id"),
    lastPostAt: integer("last_post_at").notNull(),
    lastPostId: integer("last_post_id"),
    lastPosterId: integer("last_poster_id").notNull(),
  },
  (t) => [
    // threads.list: WHERE node_id = ? AND is_sticky = ? ORDER BY last_post_at DESC, id DESC
    index("threads_node_list").on(t.nodeId, t.isSticky, t.lastPostAt, t.id),
  ],
);

export const posts = sqliteTable(
  "posts",
  {
    id: integer("id").primaryKey(),
    threadId: integer("thread_id")
      .notNull()
      .references(() => threads.id),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    /**
     * 0-based position in the thread in creation order (the first post is 0). Never changes:
     * hiding or restoring a post leaves every position as it is (see DECISIONS.md
     * "Post positions").
     */
    position: integer("position").notNull(),
    state: state(),
    createdAt: integer("created_at").notNull(),
    editedAt: integer("edited_at"),
    reactionCounts: reactionCounts(),
  },
  (t) => [
    // posts.list: WHERE thread_id = ? AND position BETWEEN ? AND ? ORDER BY position
    index("posts_thread_position").on(t.threadId, t.position),
  ],
);

/**
 * Post bodies, kept out of `posts` so the hot listing and counter queries touch narrow rows.
 * Insert the `posts` row first, then its body. The search triggers hang off this table.
 */
export const postBodies = sqliteTable("post_bodies", {
  postId: integer("post_id")
    .primaryKey()
    .references(() => posts.id),
  /** Markdown source as written by the author. */
  bodySource: text("body_source").notNull(),
  /** Sanitized HTML rendered from bodySource at write time. */
  bodyHtml: text("body_html").notNull(),
});

export const threadReads = sqliteTable(
  "thread_reads",
  {
    id: integer("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    threadId: integer("thread_id")
      .notNull()
      .references(() => threads.id),
    /** Newest post id the user has read. Unread = threads.last_post_id > this. */
    lastReadPostId: integer("last_read_post_id").notNull(),
    /** Position of that post (a jump target for "continue reading"). */
    lastReadPosition: integer("last_read_position").notNull(),
    readAt: integer("read_at").notNull(),
  },
  (t) => [uniqueIndex("thread_reads_user_thread").on(t.userId, t.threadId)],
);

// ---------------------------------------------------------------------------
// Profiles

export const profilePosts = sqliteTable(
  "profile_posts",
  {
    id: integer("id").primaryKey(),
    /** Whose wall the post is on. */
    profileUserId: integer("profile_user_id")
      .notNull()
      .references(() => users.id),
    /** Author. */
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    state: state(),
    createdAt: integer("created_at").notNull(),
    editedAt: integer("edited_at"),
    bodySource: text("body_source").notNull(),
    bodyHtml: text("body_html").notNull(),
    reactionCounts: reactionCounts(),
    /** Visible comments. */
    commentCount: counter("comment_count"),
    lastCommentAt: integer("last_comment_at"),
  },
  (t) => [
    // profilePosts.list: WHERE profile_user_id = ? ORDER BY id DESC
    index("profile_posts_wall").on(t.profileUserId, t.id),
  ],
);

export const profilePostComments = sqliteTable(
  "profile_post_comments",
  {
    id: integer("id").primaryKey(),
    profilePostId: integer("profile_post_id")
      .notNull()
      .references(() => profilePosts.id),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    state: state(),
    createdAt: integer("created_at").notNull(),
    editedAt: integer("edited_at"),
    bodySource: text("body_source").notNull(),
    bodyHtml: text("body_html").notNull(),
    reactionCounts: reactionCounts(),
  },
  (t) => [
    // comments of a profile post, by id
    index("profile_post_comments_post").on(t.profilePostId, t.id),
  ],
);

// ---------------------------------------------------------------------------
// Conversations

export const conversations = sqliteTable("conversations", {
  id: integer("id").primaryKey(),
  title: text("title").notNull(),
  /** Starter. */
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at").notNull(),
  lastMessageAt: integer("last_message_at").notNull(),
  lastMessageId: integer("last_message_id"),
  lastMessageUserId: integer("last_message_user_id").notNull(),
  /** Visible messages, including the first. */
  messageCount: counter("message_count"),
  /** Active participants. */
  participantCount: counter("participant_count"),
});

export const conversationParticipants = sqliteTable(
  "conversation_participants",
  {
    id: integer("id").primaryKey(),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversations.id),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    state: text("state", { enum: PARTICIPANT_STATES }).notNull().default("active"),
    joinedAt: integer("joined_at").notNull(),
    /** Copy of conversations.last_message_at, so the inbox query is index-only. */
    lastMessageAt: integer("last_message_at").notNull(),
    /** Id of the newest message this participant has read; 0 if none.
     *  Unread = conversations.last_message_id > this. */
    lastReadMessageId: integer("last_read_message_id").notNull().default(0),
  },
  (t) => [
    uniqueIndex("conversation_participants_conv_user").on(t.conversationId, t.userId),
    // conversations.list: WHERE user_id = ? AND state = 'active'
    //   ORDER BY last_message_at DESC, conversation_id DESC
    index("conversation_participants_inbox").on(
      t.userId,
      t.state,
      t.lastMessageAt,
      t.conversationId,
    ),
  ],
);

export const conversationMessages = sqliteTable(
  "conversation_messages",
  {
    id: integer("id").primaryKey(),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversations.id),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    state: state(),
    createdAt: integer("created_at").notNull(),
    bodySource: text("body_source").notNull(),
    bodyHtml: text("body_html").notNull(),
    reactionCounts: reactionCounts(),
  },
  (t) => [index("conversation_messages_conv").on(t.conversationId, t.id)],
);

// ---------------------------------------------------------------------------
// Reactions

export const reactionTypes = sqliteTable("reaction_types", {
  id: integer("id").primaryKey(),
  title: text("title").notNull(),
  emoji: text("emoji").notNull(),
  /** Added to the content author's reaction_score per reaction. */
  score: integer("score").notNull().default(1),
  position: integer("position").notNull().default(0),
  isActive: bool("is_active").notNull().default(true),
});

export const reactions = sqliteTable(
  "reactions",
  {
    id: integer("id").primaryKey(),
    contentType: text("content_type", { enum: REACTION_CONTENT_TYPES }).notNull(),
    contentId: integer("content_id").notNull(),
    /** Who reacted. */
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    /** Author of the content (receiver of the reaction score). */
    contentUserId: integer("content_user_id")
      .notNull()
      .references(() => users.id),
    reactionTypeId: integer("reaction_type_id")
      .notNull()
      .references(() => reactionTypes.id),
    /** The type's score when the reaction was made; removing it subtracts exactly this. */
    score: integer("score").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    // One reaction per user per item; also serves the viewer batch lookup and
    // reactions.list (ordered by user_id).
    uniqueIndex("reactions_content_user").on(t.contentType, t.contentId, t.userId),
  ],
);

// ---------------------------------------------------------------------------
// Infrastructure

export const jobs = sqliteTable(
  "jobs",
  {
    id: integer("id").primaryKey(),
    type: text("type").notNull(),
    /** JSON. */
    payload: text("payload").notNull().default("{}"),
    status: text("status", { enum: JOB_STATUSES }).notNull().default("pending"),
    runAt: integer("run_at").notNull(),
    attempts: counter("attempts"),
    lastError: text("last_error"),
    /** While running: lease expiry. A running job whose lease expired may be claimed again. */
    lockedUntil: integer("locked_until"),
    /** Optional de-duplication key: at most one job per key exists at a time. */
    uniqueKey: text("unique_key"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("jobs_status_run_at").on(t.status, t.runAt),
    uniqueIndex("jobs_unique_key").on(t.uniqueKey),
  ],
);

/**
 * Version counters for in-memory caches. Bumping a key in a write transaction invalidates that
 * cache in every process sharing the database file.
 */
export const cacheVersions = sqliteTable(
  "cache_versions",
  {
    id: integer("id").primaryKey(),
    key: text("key").notNull(),
    version: integer("version").notNull().default(0),
  },
  (t) => [uniqueIndex("cache_versions_key").on(t.key)],
);
