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
export const FILE_VISIBILITIES = ["unattached", "public", "private"] as const;
export const FILE_PURPOSES = ["attachment", "avatar", "cover", "node_icon", "node_cover"] as const;
export const ATTACHMENT_CONTENT_TYPES = ["post", "profile_post", "conversation_message"] as const;
export const REPORT_TARGET_TYPES = [
  "post",
  "profile_post",
  "profile_post_comment",
  "conversation_message",
  "user",
] as const;
export const REPORT_STATES = ["open", "assigned", "resolved", "rejected"] as const;
export const PERMISSION_SCOPES = ["global", "node"] as const;
export const PERMISSION_VALUE_TYPES = ["flag", "integer"] as const;
export const USER_PROMOTION_STATES = ["auto", "manual", "exempt"] as const;
export const PROMOTION_LOG_ACTIONS = ["promote", "demote", "exempt", "reset"] as const;
export const AUTO_WATCH_MODES = ["none", "watch", "watch_email"] as const;
export const PROFILE_VIEW_PRIVACY = ["everyone", "members", "followed", "self"] as const;
export const PROFILE_POST_PRIVACY = ["members", "followed", "self"] as const;
export const NODE_WATCH_MODES = ["threads", "posts"] as const;
export const RESTRICTION_KINDS = ["posting", "conversations", "profile_posts"] as const;
export type RestrictionKind = (typeof RESTRICTION_KINDS)[number];
/** Stored in users.restricted_*_until for a restriction without expiry (year 9999). */
export const RESTRICTION_PERMANENT = 253_402_300_799_999;

const bool = (name: string) => integer(name, { mode: "boolean" });
const counter = (name: string) => integer(name).notNull().default(0);
const state = () => text("state", { enum: CONTENT_STATES }).notNull().default("visible");
const reactionCounts = () => text("reaction_counts").notNull().default("{}");

// ---------------------------------------------------------------------------
// Users and groups

/** Fixed ids of the built-in groups created by the migrations. */
export const GROUP_IDS = { guest: 1, member: 2, moderator: 3, admin: 4, unconfirmed: 5 } as const;
export const BUILTIN_GROUPS = ["guest", "unconfirmed", "registered", "moderator", "admin"] as const;
export type BuiltinGroup = (typeof BUILTIN_GROUPS)[number];

export const groups = sqliteTable(
  "groups",
  {
    id: integer("id").primaryKey(),
    title: text("title").notNull(),
    /**
     * Legacy flags, kept only as write-through shims: triggers mirror writes to them into
     * permission_entries. Nothing reads them; permissions come from permission_entries.
     */
    isAdmin: bool("is_admin").notNull().default(false),
    isModerator: bool("is_moderator").notNull().default(false),
    canViewNodes: bool("can_view_nodes").notNull().default(true),
    canPost: bool("can_post").notNull().default(false),
    canViewProfiles: bool("can_view_profiles").notNull().default(true),
    canPostProfile: bool("can_post_profile").notNull().default(false),
    canStartConversations: bool("can_start_conversations").notNull().default(false),
    canReact: bool("can_react").notNull().default(false),
    description: text("description").notNull().default(""),
    /** Display and hierarchy only; never used to resolve permissions. */
    rank: integer("rank").notNull().default(0),
    userTitle: text("user_title").notNull().default(""),
    badge: text("badge").notNull().default(""),
    builtin: text("builtin", { enum: BUILTIN_GROUPS }),
  },
  (t) => [uniqueIndex("groups_builtin").on(t.builtin)],
);

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
    avatarFileId: integer("avatar_file_id"),
    coverFileId: integer("cover_file_id"),
    contentUpdatedAt: integer("content_updated_at"),
    bannedUntil: integer("banned_until"),
    bannedPermanently: bool("banned_permanently").notNull().default(false),
    /**
     * The permission combination this member's permissions are cached under. Maintained by
     * triggers whenever the member's groups or member-specific entries change.
     */
    permissionCombinationId: integer("permission_combination_id").notNull().default(0),
    /** Buffered in memory by requests and flushed by the scheduler. */
    lastActivityAt: integer("last_activity_at"),
    followerCount: counter("follower_count"),
    followingCount: counter("following_count"),
    unreadNotificationCount: counter("unread_notification_count"),
    /** Bumped by "mark all read": unread notifications of older epochs count as read. */
    notificationEpoch: counter("notification_epoch"),
    /** BCP 47 language tag; null uses the site default. */
    language: text("language"),
    watchOnCreate: text("watch_on_create", { enum: AUTO_WATCH_MODES }).notNull().default("watch"),
    watchOnReply: text("watch_on_reply", { enum: AUTO_WATCH_MODES }).notNull().default("watch"),
    profileViewPrivacy: text("profile_view_privacy", { enum: PROFILE_VIEW_PRIVACY })
      .notNull()
      .default("everyone"),
    profilePostPrivacy: text("profile_post_privacy", { enum: PROFILE_POST_PRIVACY })
      .notNull()
      .default("members"),
    /** Active restriction expiry per kind; null = none, RESTRICTION_PERMANENT = no expiry. */
    restrictedPostingUntil: integer("restricted_posting_until"),
    restrictedConversationsUntil: integer("restricted_conversations_until"),
    restrictedProfilePostsUntil: integer("restricted_profile_posts_until"),
    emailWindowStart: counter("email_window_start"),
    emailWindowCount: counter("email_window_count"),
    lastDigestAt: integer("last_digest_at"),
  },
  (t) => [
    uniqueIndex("users_username_key").on(t.usernameKey),
    index("users_permission_combination").on(t.permissionCombinationId),
  ],
);

/** Secondary groups assigned by hand. */
export const userGroups = sqliteTable(
  "user_groups",
  {
    id: integer("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    groupId: integer("group_id")
      .notNull()
      .references(() => groups.id),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("user_groups_user_group").on(t.userId, t.groupId),
    index("user_groups_group").on(t.groupId, t.userId),
  ],
);

// ---------------------------------------------------------------------------
// Permissions (see src/permissions)

/** Every permission the code registry declares, added when it first appears. */
export const permissionDefinitions = sqliteTable(
  "permission_definitions",
  {
    id: integer("id").primaryKey(),
    key: text("key").notNull(),
    scope: text("scope", { enum: PERMISSION_SCOPES }).notNull(),
    valueType: text("value_type", { enum: PERMISSION_VALUE_TYPES }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("permission_definitions_key").on(t.key)],
);

/**
 * One value for one permission, for exactly one group or one member (the other id is 0), at the
 * global scope (node_id = 0) or on a node. Flags: 1 allow, 0 no (nodes only), -1 never; a
 * missing row is unset / inherit. Integers: the value, -1 meaning unlimited.
 */
export const permissionEntries = sqliteTable(
  "permission_entries",
  {
    id: integer("id").primaryKey(),
    permissionId: integer("permission_id")
      .notNull()
      .references(() => permissionDefinitions.id),
    nodeId: integer("node_id").notNull().default(0),
    groupId: integer("group_id").notNull().default(0),
    userId: integer("user_id").notNull().default(0),
    value: integer("value").notNull(),
  },
  (t) => [
    uniqueIndex("permission_entries_target").on(t.groupId, t.userId, t.nodeId, t.permissionId),
    index("permission_entries_node").on(t.nodeId),
  ],
);

/** A distinct set of groups, private to one member when they have member-specific entries. */
export const permissionCombinations = sqliteTable(
  "permission_combinations",
  {
    id: integer("id").primaryKey(),
    userId: integer("user_id").notNull().default(0),
    /** Sorted, comma-separated group ids. */
    groupIds: text("group_ids").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("permission_combinations_key").on(t.userId, t.groupIds)],
);

/** Version of each layer (one group's entries, or one member's entries). */
export const permissionLayerVersions = sqliteTable(
  "permission_layer_versions",
  {
    id: integer("id").primaryKey(),
    groupId: integer("group_id").notNull().default(0),
    userId: integer("user_id").notNull().default(0),
    version: integer("version").notNull().default(0),
  },
  (t) => [uniqueIndex("permission_layer_versions_layer").on(t.groupId, t.userId)],
);

// ---------------------------------------------------------------------------
// Promotions

export const promotions = sqliteTable("promotions", {
  id: integer("id").primaryKey(),
  title: text("title").notNull(),
  isActive: bool("is_active").notNull().default(true),
  /** JSON array of {criterion, value}; all must hold. */
  criteria: text("criteria").notNull().default("[]"),
  /** JSON array of secondary group ids to add. */
  groupIds: text("group_ids").notNull().default("[]"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** 'auto' (applied by evaluation), 'manual' (promoted by hand), 'exempt' (never applied). */
export const userPromotions = sqliteTable(
  "user_promotions",
  {
    id: integer("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    promotionId: integer("promotion_id")
      .notNull()
      .references(() => promotions.id, { onDelete: "cascade" }),
    state: text("state", { enum: USER_PROMOTION_STATES }).notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("user_promotions_user_promotion").on(t.userId, t.promotionId),
    index("user_promotions_promotion").on(t.promotionId, t.userId),
  ],
);

/** Secondary groups granted by an applied promotion (separate from hand-assigned groups). */
export const userGroupGrants = sqliteTable(
  "user_group_grants",
  {
    id: integer("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    promotionId: integer("promotion_id")
      .notNull()
      .references(() => promotions.id, { onDelete: "cascade" }),
    groupId: integer("group_id")
      .notNull()
      .references(() => groups.id),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("user_group_grants_key").on(t.userId, t.promotionId, t.groupId),
    index("user_group_grants_group").on(t.groupId, t.userId),
  ],
);

export const promotionLog = sqliteTable(
  "promotion_log",
  {
    id: integer("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    promotionId: integer("promotion_id").notNull(),
    action: text("action", { enum: PROMOTION_LOG_ACTIONS }).notNull(),
    /** Null for automatic changes. */
    actorId: integer("actor_id"),
    groupIds: text("group_ids").notNull().default("[]"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("promotion_log_user").on(t.userId, t.id),
    index("promotion_log_recent").on(t.createdAt, t.id),
  ],
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
    iconFileId: integer("icon_file_id"),
    coverFileId: integer("cover_file_id"),
    contentUpdatedAt: integer("content_updated_at"),
    requireThreadApproval: bool("require_thread_approval").notNull().default(false),
    requireReplyApproval: bool("require_reply_approval").notNull().default(false),
    isReadOnly: bool("is_read_only").notNull().default(false),
    minAccountAgeDays: counter("min_account_age_days"),
    minPostCount: counter("min_post_count"),
  },
  (t) => [index("nodes_parent_position").on(t.parentId, t.position)],
);

/**
 * Legacy per-node, per-group overrides (null = inherit), kept only as a write-through shim:
 * triggers mirror writes into permission_entries. Nothing reads it.
 */
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
    excerpt: text("excerpt").notNull().default(""),
    contentUpdatedAt: integer("content_updated_at"),
    /** Set on a merged thread's tombstone (state 'deleted'): the thread its id resolves to. */
    mergedIntoId: integer("merged_into_id"),
  },
  (t) => [
    // threads.list: WHERE node_id = ? AND is_sticky = ? ORDER BY last_post_at DESC, id DESC
    index("threads_node_list").on(t.nodeId, t.isSticky, t.lastPostAt, t.id),
    index("threads_public_feed").on(t.state, t.lastPostAt, t.id),
    index("threads_node_feed").on(t.nodeId, t.state, t.lastPostAt, t.id),
    index("threads_state_id").on(t.state, t.id),
    index("threads_user_id").on(t.userId, t.id),
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
    attachmentCount: counter("attachment_count"),
  },
  (t) => [
    // posts.list: WHERE thread_id = ? AND position BETWEEN ? AND ? ORDER BY position
    index("posts_thread_position").on(t.threadId, t.position),
    // Counter rebuild: a user's visible posts (joined to their thread's state), index-only.
    index("posts_user").on(t.userId, t.state, t.threadId),
    index("posts_state_id").on(t.state, t.id),
    index("posts_user_id").on(t.userId, t.id),
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
  (t) => [
    uniqueIndex("thread_reads_user_thread").on(t.userId, t.threadId),
    // Readers of one thread (thread merges and splits).
    index("thread_reads_thread").on(t.threadId, t.userId),
  ],
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
    attachmentCount: counter("attachment_count"),
    /** Visible comments. */
    commentCount: counter("comment_count"),
    lastCommentAt: integer("last_comment_at"),
  },
  (t) => [
    // profilePosts.list: WHERE profile_user_id = ? ORDER BY id DESC
    index("profile_posts_wall").on(t.profileUserId, t.id),
    index("profile_posts_state_id").on(t.state, t.id),
    index("profile_posts_user_id").on(t.userId, t.id),
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
    index("profile_post_comments_post_user").on(t.profilePostId, t.userId),
    index("profile_post_comments_state_id").on(t.state, t.id),
    index("profile_post_comments_user_id").on(t.userId, t.id),
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
    attachmentCount: counter("attachment_count"),
  },
  (t) => [
    index("conversation_messages_conv").on(t.conversationId, t.id),
    index("conversation_messages_state_id").on(t.state, t.id),
    index("conversation_messages_user_id").on(t.userId, t.id),
  ],
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
    // Counter rebuild: the reaction score a user received, index-only.
    index("reactions_recipient").on(t.contentUserId, t.score),
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

// ---------------------------------------------------------------------------
// Files, attachments, and transfer accounting

export const files = sqliteTable(
  "files",
  {
    id: integer("id").primaryKey(),
    driver: text("driver").notNull(),
    storageKey: text("storage_key").notNull(),
    byteSize: integer("byte_size").notNull(),
    contentType: text("content_type").notNull(),
    sha256: text("sha256").notNull(),
    width: integer("width"),
    height: integer("height"),
    uploaderId: integer("uploader_id")
      .notNull()
      .references(() => users.id),
    purpose: text("purpose", { enum: FILE_PURPOSES }).notNull(),
    visibility: text("visibility", { enum: FILE_VISIBILITIES }).notNull().default("unattached"),
    parentFileId: integer("parent_file_id"),
    variant: text("variant"),
    downloadCount: counter("download_count"),
    createdAt: integer("created_at").notNull(),
    attachedAt: integer("attached_at"),
    deletedAt: integer("deleted_at"),
  },
  (t) => [
    uniqueIndex("files_driver_key").on(t.driver, t.storageKey),
    index("files_unattached_cleanup").on(t.visibility, t.createdAt, t.id),
    index("files_uploader").on(t.uploaderId, t.createdAt, t.id),
    uniqueIndex("files_variant").on(t.parentFileId, t.variant),
  ],
);

export const attachments = sqliteTable(
  "attachments",
  {
    id: integer("id").primaryKey(),
    fileId: integer("file_id")
      .notNull()
      .references(() => files.id),
    contentType: text("content_type", { enum: ATTACHMENT_CONTENT_TYPES }).notNull(),
    contentId: integer("content_id").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("attachments_file").on(t.fileId),
    index("attachments_content").on(t.contentType, t.contentId, t.position),
  ],
);

// ---------------------------------------------------------------------------
// Moderation

export const reportGroups = sqliteTable(
  "report_groups",
  {
    id: integer("id").primaryKey(),
    targetType: text("target_type", { enum: REPORT_TARGET_TYPES }).notNull(),
    targetId: integer("target_id").notNull(),
    state: text("state", { enum: REPORT_STATES }).notNull().default("open"),
    assignedToId: integer("assigned_to_id").references(() => users.id),
    reportCount: counter("report_count"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    resolvedAt: integer("resolved_at"),
    /** Node of the reported forum content; null for profile content, members and messages. */
    nodeId: integer("node_id"),
  },
  (t) => [
    uniqueIndex("report_groups_target").on(t.targetType, t.targetId),
    index("report_groups_queue").on(t.state, t.updatedAt, t.id),
    index("report_groups_assignee").on(t.assignedToId, t.state, t.updatedAt),
    index("report_groups_node_queue").on(t.nodeId, t.state, t.updatedAt, t.id),
  ],
);

export const reports = sqliteTable(
  "reports",
  {
    id: integer("id").primaryKey(),
    groupId: integer("group_id")
      .notNull()
      .references(() => reportGroups.id),
    reporterId: integer("reporter_id")
      .notNull()
      .references(() => users.id),
    reason: text("reason").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("reports_group").on(t.groupId, t.id),
    index("reports_reporter").on(t.reporterId, t.createdAt),
  ],
);

export const warnings = sqliteTable(
  "warnings",
  {
    id: integer("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    moderatorId: integer("moderator_id")
      .notNull()
      .references(() => users.id),
    points: integer("points").notNull(),
    reason: text("reason").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at"),
  },
  (t) => [index("warnings_user_expiry").on(t.userId, t.expiresAt, t.id)],
);

export const bans = sqliteTable(
  "bans",
  {
    id: integer("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    moderatorId: integer("moderator_id")
      .notNull()
      .references(() => users.id),
    reason: text("reason").notNull(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at"),
    liftedAt: integer("lifted_at"),
  },
  (t) => [index("bans_user_active").on(t.userId, t.liftedAt, t.expiresAt)],
);

export const wordFilters = sqliteTable(
  "word_filters",
  {
    id: integer("id").primaryKey(),
    term: text("term").notNull(),
    action: text("action", { enum: ["replace", "moderate"] }).notNull(),
    replacement: text("replacement"),
    isActive: bool("is_active").notNull().default(true),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("word_filters_term").on(t.term),
    index("word_filters_active").on(t.isActive, t.id),
  ],
);

export const postRevisions = sqliteTable(
  "post_revisions",
  {
    id: integer("id").primaryKey(),
    postId: integer("post_id")
      .notNull()
      .references(() => posts.id),
    editorId: integer("editor_id")
      .notNull()
      .references(() => users.id),
    bodySource: text("body_source").notNull(),
    bodyHtml: text("body_html").notNull(),
    editedAt: integer("edited_at").notNull(),
  },
  (t) => [index("post_revisions_post").on(t.postId, t.id)],
);

export const moderatorLog = sqliteTable(
  "moderator_log",
  {
    id: integer("id").primaryKey(),
    actorId: integer("actor_id")
      .notNull()
      .references(() => users.id),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: integer("target_id").notNull(),
    reason: text("reason").notNull().default(""),
    details: text("details").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
    /** Node the action concerns, so the log can be filtered and scoped by node. */
    nodeId: integer("node_id"),
  },
  (t) => [
    index("moderator_log_recent").on(t.createdAt, t.id),
    index("moderator_log_actor").on(t.actorId, t.id),
    index("moderator_log_target").on(t.targetType, t.targetId, t.id),
    index("moderator_log_node").on(t.nodeId, t.id),
  ],
);

export const threadBans = sqliteTable(
  "thread_bans",
  {
    id: integer("id").primaryKey(),
    threadId: integer("thread_id")
      .notNull()
      .references(() => threads.id),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    moderatorId: integer("moderator_id")
      .notNull()
      .references(() => users.id),
    reason: text("reason").notNull().default(""),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at"),
  },
  (t) => [
    uniqueIndex("thread_bans_thread_user").on(t.threadId, t.userId),
    index("thread_bans_user").on(t.userId, t.id),
  ],
);

/** History of restrictions; users.restricted_*_until holds the active expiry per kind. */
export const userRestrictions = sqliteTable(
  "user_restrictions",
  {
    id: integer("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: RESTRICTION_KINDS }).notNull(),
    moderatorId: integer("moderator_id")
      .notNull()
      .references(() => users.id),
    reason: text("reason").notNull().default(""),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at"),
    liftedAt: integer("lifted_at"),
  },
  (t) => [index("user_restrictions_user").on(t.userId, t.kind, t.id)],
);

// ---------------------------------------------------------------------------
// Markdown extensions

/** Mentions resolved to user ids on write, so renames never break them. */
export const contentMentions = sqliteTable(
  "content_mentions",
  {
    id: integer("id").primaryKey(),
    contentType: text("content_type").notNull(),
    contentId: integer("content_id").notNull(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("content_mentions_content_user").on(t.contentType, t.contentId, t.userId),
    index("content_mentions_user").on(t.userId, t.id),
  ],
);

export const contentQuotes = sqliteTable(
  "content_quotes",
  {
    id: integer("id").primaryKey(),
    contentType: text("content_type").notNull(),
    contentId: integer("content_id").notNull(),
    quotedPostId: integer("quoted_post_id").notNull(),
    quotedUserId: integer("quoted_user_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("content_quotes_content_post").on(t.contentType, t.contentId, t.quotedPostId),
    index("content_quotes_content_user").on(t.contentType, t.contentId, t.quotedUserId),
    index("content_quotes_post").on(t.quotedPostId),
  ],
);

// ---------------------------------------------------------------------------
// Watching, following, ignoring

export const threadWatches = sqliteTable(
  "thread_watches",
  {
    id: integer("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    threadId: integer("thread_id")
      .notNull()
      .references(() => threads.id),
    email: bool("email").notNull().default(false),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("thread_watches_thread_user").on(t.threadId, t.userId),
    index("thread_watches_user").on(t.userId, t.id),
  ],
);

export const nodeWatches = sqliteTable(
  "node_watches",
  {
    id: integer("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    nodeId: integer("node_id")
      .notNull()
      .references(() => nodes.id),
    mode: text("mode", { enum: NODE_WATCH_MODES }).notNull(),
    email: bool("email").notNull().default(false),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("node_watches_node_user").on(t.nodeId, t.userId),
    index("node_watches_user").on(t.userId, t.id),
  ],
);

export const userFollows = sqliteTable(
  "user_follows",
  {
    id: integer("id").primaryKey(),
    /** The follower. */
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    followedId: integer("followed_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("user_follows_pair").on(t.userId, t.followedId),
    index("user_follows_followed").on(t.followedId, t.userId),
    index("user_follows_followed_recent").on(t.followedId, t.id),
    index("user_follows_follower_recent").on(t.userId, t.id),
  ],
);

export const userIgnores = sqliteTable(
  "user_ignores",
  {
    id: integer("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ignoredId: integer("ignored_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("user_ignores_pair").on(t.userId, t.ignoredId),
    index("user_ignores_ignored").on(t.ignoredId, t.userId),
    index("user_ignores_user_recent").on(t.userId, t.id),
  ],
);

// ---------------------------------------------------------------------------
// Notifications, email, push
// Partial indexes on notifications are declared in migration 0010, not here.

export const notifications = sqliteTable(
  "notifications",
  {
    id: integer("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    contentType: text("content_type").notNull(),
    contentId: integer("content_id").notNull(),
    /** Thread the content belongs to, so reading a thread clears its notifications. */
    threadId: integer("thread_id"),
    /** Most recent actor; null for system notifications. */
    actorId: integer("actor_id"),
    actorCount: integer("actor_count").notNull().default(1),
    /** JSON array of the most recent actor ids, newest first. */
    actorIds: text("actor_ids").notNull().default("[]"),
    /** Unread notifications with the same key are merged; null never merges. */
    groupKey: text("group_key"),
    data: text("data").notNull().default("{}"),
    /** Highest domain event merged into this row; replays of older events are ignored. */
    lastEventId: integer("last_event_id").notNull().default(0),
    /** The recipient's notification epoch when written; older epochs count as read. */
    epoch: integer("epoch").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    readAt: integer("read_at"),
  },
  (t) => [
    index("notifications_user_recent").on(t.userId, t.updatedAt, t.id),
    index("notifications_content").on(t.contentType, t.contentId),
  ],
);

/** Per member, per type overrides of the admin defaults; null columns use the default. */
export const notificationPreferences = sqliteTable(
  "notification_preferences",
  {
    id: integer("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    inApp: bool("in_app"),
    email: bool("email"),
    push: bool("push"),
  },
  (t) => [uniqueIndex("notification_preferences_user_type").on(t.userId, t.type)],
);

export const announcements = sqliteTable("announcements", {
  id: integer("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  title: text("title").notNull(),
  bodySource: text("body_source").notNull(),
  bodyHtml: text("body_html").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const emailFailures = sqliteTable(
  "email_failures",
  {
    id: integer("id").primaryKey(),
    userId: integer("user_id"),
    email: text("email").notNull(),
    template: text("template").notNull(),
    error: text("error").notNull(),
    permanent: bool("permanent").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("email_failures_recent").on(t.createdAt, t.id)],
);

/** Addresses the receiving server rejected outright; nothing more is sent to them. */
export const undeliverableEmails = sqliteTable(
  "undeliverable_emails",
  {
    id: integer("id").primaryKey(),
    email: text("email").notNull(),
    reason: text("reason").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("undeliverable_emails_email").on(t.email)],
);

export const pushSubscriptions = sqliteTable(
  "push_subscriptions",
  {
    id: integer("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent").notNull().default(""),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("push_subscriptions_endpoint").on(t.endpoint),
    index("push_subscriptions_user").on(t.userId, t.id),
  ],
);

// Site settings are intentionally rows, so admins can change rules without restarting the server.
export const siteSettings = sqliteTable("site_settings", {
  id: integer("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// Durable events are written in the same transaction as the domain change. Job subscribers
// consume them after commit; a future federation subscriber can use the same ordered stream.
export const domainEvents = sqliteTable(
  "domain_events",
  {
    id: integer("id").primaryKey(),
    type: text("type").notNull(),
    targetType: text("target_type").notNull(),
    targetId: integer("target_id").notNull(),
    payload: text("payload").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("domain_events_target").on(t.targetType, t.targetId, t.id)],
);

export const eventSubscribers = sqliteTable("event_subscribers", {
  id: integer("id").primaryKey(),
  name: text("name").notNull().unique(),
  lastEventId: integer("last_event_id").notNull().default(0),
  updatedAt: integer("updated_at").notNull(),
});
