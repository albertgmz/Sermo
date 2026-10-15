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

import { desc, sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { auth_session, auth_user } from "./auth-schema";

/**
 * The rule column default: `{ match, conditions }` (shared/criteria.ts) with no conditions, which
 * matches everyone.
 */
export const EMPTY_RULE = '{"match":"all","conditions":[]}';

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
/** Purposes a member uploads for; the allowed types of each are a site setting. */
export const UPLOAD_SETTING_PURPOSES = [
  "attachment",
  "avatar",
  "cover",
  "node_icon",
  "node_cover",
] as const;
/**
 * Purposes of the pictures an administrator uploads for everyone: the catalogs members pick
 * from, the art of awards and shop items, and the identity of the site. They are raster only,
 * never count against a storage quota, and are never deleted while something refers to them.
 */
export const CATALOG_FILE_PURPOSES = [
  "frame",
  "cover_preset",
  "thread_cover",
  "award_image",
  "shop_image",
  "site_logo",
  "site_icon",
  "site_backdrop",
  "reaction_image",
] as const;
export const FILE_PURPOSES = [...UPLOAD_SETTING_PURPOSES, ...CATALOG_FILE_PURPOSES] as const;
/** Picture catalogs members choose from. */
export const CATALOG_IMAGE_KINDS = ["frame", "profile_cover", "thread_cover"] as const;
/** Colour catalogs: site accents, member name colours, thread prefix colours. */
export const PALETTE_KINDS = ["accent", "name", "prefix"] as const;
export const ATTACHMENT_CONTENT_TYPES = [
  "post",
  "profile_post",
  "conversation_message",
  "poll",
] as const;
export const REPORT_TARGET_TYPES = [
  "post",
  "profile_post",
  "profile_post_comment",
  "conversation_message",
  "user",
] as const;
export const REPORT_STATES = ["open", "assigned", "resolved", "rejected"] as const;
/** What a member can bookmark. */
export const BOOKMARK_CONTENT_TYPES = ["thread", "post", "conversation"] as const;
export type BookmarkContentType = (typeof BOOKMARK_CONTENT_TYPES)[number];
/** Content whose spoilers are stored apart from its HTML and revealed on request. */
export const SPOILER_CONTENT_TYPES = [
  "post",
  "profile_post",
  "profile_post_comment",
  "conversation_message",
] as const;
export type SpoilerContentType = (typeof SPOILER_CONTENT_TYPES)[number];
/** Who an administrator's alert goes to; `group` and `users` name them in the row. */
export const ANNOUNCEMENT_AUDIENCES = ["all", "group", "users"] as const;
export const PERMISSION_SCOPES = ["global", "node"] as const;
export const PERMISSION_VALUE_TYPES = ["flag", "integer"] as const;
export const USER_PROMOTION_STATES = ["auto", "manual", "exempt"] as const;
export const PROMOTION_LOG_ACTIONS = ["promote", "demote", "exempt", "reset"] as const;
/** The tabs of the home page, in the fixed order they fill the bar after the default tab. */
export const HOME_TABS = ["latest", "hot", "following", "forums", "media"] as const;
export type HomeTab = (typeof HOME_TABS)[number];
export const AUTO_WATCH_MODES = ["none", "watch", "watch_email"] as const;
export const PROFILE_VIEW_PRIVACY = ["everyone", "members", "followed", "self"] as const;
export const PROFILE_POST_PRIVACY = ["members", "followed", "self"] as const;
export const NODE_WATCH_MODES = ["threads", "posts"] as const;
export const RESTRICTION_KINDS = ["posting", "conversations", "profile_posts"] as const;
export type RestrictionKind = (typeof RESTRICTION_KINDS)[number];
/**
 * Why a new account waits in the sign-up queue: `pending`, or `flagged` when the spam check
 * flagged it at sign-up. Null for an account the queue never held (or no longer holds).
 */
export const SIGNUP_REVIEWS = ["pending", "flagged"] as const;
export type SignupReview = (typeof SIGNUP_REVIEWS)[number];
/**
 * Kinds of credit ledger rows. The column is plain text, so a later feature (a lottery, a wager)
 * adds its kinds here without a migration.
 */
export const CREDIT_TRANSACTION_TYPES = [
  "adjustment",
  "event",
  "event_reversal",
  "award",
  "award_revoked",
  "purchase",
] as const;
export type CreditTransactionType = (typeof CREDIT_TRANSACTION_TYPES)[number];
/** Facts Sermo already records that a credit rule can react to. */
export const CREDIT_TRIGGERS = [
  "thread_created",
  "reply_posted",
  "reply_received",
  "reaction_given",
  "reaction_received",
  "profile_post_created",
  "profile_post_received",
  "followed",
  "registered",
  "daily_activity",
  "warning_received",
  "award_received",
] as const;
export type CreditTrigger = (typeof CREDIT_TRIGGERS)[number];
export const CREDIT_APPLICATION_STATES = ["applied", "reverted"] as const;
export const AWARD_TIERS = ["bronze", "silver", "gold", "legendary"] as const;
/**
 * `active`: a non-consumable item in effect. `unused`: a consumable with units left. `used`: a
 * consumable with none left. `expired`: a temporary item past its end.
 */
export const SHOP_INVENTORY_STATES = ["active", "unused", "used", "expired"] as const;
export type ShopInventoryState = (typeof SHOP_INVENTORY_STATES)[number];
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
    /** A palette_colors row of kind `name`: members of the group show their name in it. */
    nameColorId: integer("name_color_id"),
    /** Its members are listed as staff. */
    isStaff: bool("is_staff").notNull().default(false),
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
    /** Whether the keyboard shortcuts of the web interface are on for this member. */
    keyboardShortcuts: bool("keyboard_shortcuts").notNull().default(true),
    /** The tab of the home page the member opens on; null follows the site default. */
    homeTab: text("home_tab", { enum: HOME_TABS }),
    /** Active restriction expiry per kind; null = none, RESTRICTION_PERMANENT = no expiry. */
    restrictedPostingUntil: integer("restricted_posting_until"),
    restrictedConversationsUntil: integer("restricted_conversations_until"),
    restrictedProfilePostsUntil: integer("restricted_profile_posts_until"),
    emailWindowStart: counter("email_window_start"),
    emailWindowCount: counter("email_window_count"),
    lastDigestAt: integer("last_digest_at"),
    /** Credit balance: always the sum of the member's credit_transactions. */
    credits: counter("credits"),
    /** XP of the awards the member holds (each grant counts). */
    awardXp: counter("award_xp"),
    /** Units the member has bought in the shop, gifts to others included. */
    shopPurchaseCount: counter("shop_purchase_count"),
    /** Chosen appearance: rows of palette_colors (accent, name) and of catalog_images. */
    accentColorId: integer("accent_color_id"),
    nameColorId: integer("name_color_id"),
    frameId: integer("frame_id"),
    /** The shop item (effect `nameIcon`) whose icon the member wears beside their name. */
    nameIconItemId: integer("name_icon_item_id"),
    /** A cover from the gallery; shown instead of an uploaded cover while set. */
    coverPresetId: integer("cover_preset_id"),
    /** When the username last changed; null if never. */
    usernameChangedAt: integer("username_changed_at"),
    /** When an administrator erased the account; null if never. An erased member never returns. */
    erasedAt: integer("erased_at"),
    /**
     * When every session of the member was last cut off. A session issued at or before it is
     * refused, whatever its cookie cache still says.
     */
    sessionsRevokedAt: integer("sessions_revoked_at"),
    /**
     * Set at sign-up while the site approves new accounts by hand and cleared when staff decide.
     * The account is "awaiting approval" once it is set and the email is confirmed (the primary
     * group is no longer Unconfirmed): it reads as a guest and takes no write.
     */
    signupReview: text("signup_review", { enum: SIGNUP_REVIEWS }),
    /** Shown under the name while the member holds profile.customTitle. */
    customTitle: text("custom_title"),
    signatureSource: text("signature_source"),
    signatureHtml: text("signature_html"),
    location: text("location").notNull().default(""),
    website: text("website").notNull().default(""),
    /** `MM-DD`; the year is optional and kept apart, so "whose birthday is today" is one seek. */
    birthdayMonthDay: text("birthday_md"),
    birthYear: integer("birth_year"),
    socialDiscord: text("social_discord").notNull().default(""),
    socialTelegram: text("social_telegram").notNull().default(""),
    socialX: text("social_x").notNull().default(""),
    /** The member who brought this one; set once, in the first days of the account. */
    referredBy: integer("referred_by"),
    referredAt: integer("referred_at"),
    /**
     * The referrer a registration named while the member still had to confirm their address: it
     * becomes referred_by when the address is confirmed or at the next sign-in, within seven days
     * of registering, and is cleared either way.
     */
    pendingReferrer: integer("pending_referrer"),
    /** Members whose referred_by is this member. */
    referralCount: counter("referral_count"),
    /** Awards currently held, counting each grant (the sum of member_award_totals.count). */
    awardCount: counter("award_count"),
    /** Tags the member has put on threads that still carry them (kept by triggers on thread_tags). */
    tagCount: counter("tag_count"),
    /** Polls and quizzes the member took part in (kept by triggers on poll_ballots). */
    pollVoteCount: counter("poll_vote_count"),
    /**
     * A super admin may act on any member, administrators included, and is the only one who can
     * grant or remove this flag. There is always at least one.
     */
    isSuperAdmin: bool("is_super_admin").notNull().default(false),
  },
  (t) => [
    uniqueIndex("users_username_key").on(t.usernameKey),
    index("users_permission_combination").on(t.permissionCombinationId),
    // "Is this catalog entry in use?" before it is deleted; few members set each.
    index("users_accent_color").on(t.accentColorId).where(sql`accent_color_id IS NOT NULL`),
    index("users_name_color").on(t.nameColorId).where(sql`name_color_id IS NOT NULL`),
    index("users_frame").on(t.frameId).where(sql`frame_id IS NOT NULL`),
    index("users_cover_preset").on(t.coverPresetId).where(sql`cover_preset_id IS NOT NULL`),
    // users.list: one index per sort, each ORDER BY <column> DESC, id ASC.
    index("users_post_count").on(desc(t.postCount), t.id),
    index("users_reaction_score").on(desc(t.reactionScore), t.id),
    index("users_award_xp").on(desc(t.awardXp), t.id),
    index("users_credits").on(desc(t.credits), t.id),
    index("users_award_count").on(desc(t.awardCount), t.id),
    index("users_referral_count").on(desc(t.referralCount), t.id),
    // users.birthdays: WHERE birthday_md = ? ORDER BY id
    index("users_birthday").on(t.birthdayMonthDay, t.id).where(sql`birthday_md IS NOT NULL`),
    // users.staff: the members whose primary group is one of the staff groups.
    index("users_group").on(t.groupId, t.id),
    // The month's referrals, for the standings job.
    index("users_referred_at").on(t.referredAt).where(sql`referred_at IS NOT NULL`),
    // A member's referrals since a time (criterion referrals_this_month).
    index("users_referrer_referred")
      .on(t.referredBy, t.referredAt)
      .where(sql`referred_by IS NOT NULL`),
    // users.adminList with state `banned`: the members with a ban column set, newest first.
    index("users_banned").on(t.id).where(sql`banned_permanently = 1 OR banned_until IS NOT NULL`),
    // The sign-up queue and its counter: the accounts awaiting approval (held, and past the
    // Unconfirmed group: the same text as AWAITING_SQL), newest first.
    index("users_signup_review").on(t.id).where(sql`signup_review IS NOT NULL AND group_id <> 5`),
    // users.adminList with state `erased`: the erased members, newest first.
    index("users_erased").on(t.id).where(sql`erased_at IS NOT NULL`),
    // "Is this the last super admin?" before the flag is removed.
    index("users_super_admin").on(t.id).where(sql`is_super_admin = 1`),
  ],
);

/**
 * Wrong answers to an administrator's own password prompt (re-entering it before a sensitive
 * change). A member gets a few per window; rows older than the window are deleted as new ones
 * are written.
 */
export const adminPasswordFailures = sqliteTable(
  "admin_password_failures",
  {
    id: integer("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    at: integer("at").notNull(),
    /** The session that gave the answer (0 for an in-process caller); null for rows made before. */
    sessionId: integer("session_id"),
  },
  (t) => [
    index("admin_password_failures_user").on(t.userId, t.at),
    index("admin_password_failures_session").on(t.userId, t.sessionId, t.at),
  ],
);

/**
 * Wrong passwords at sign-in, one row per answer. `key` is a digest of the account name or
 * address that was tried and the client address, so the table holds neither; rows older than the
 * window are deleted as new ones are written and by the hourly cleanup.
 */
export const signInFailures = sqliteTable(
  "sign_in_failures",
  {
    id: integer("id").primaryKey(),
    key: text("key").notNull(),
    at: integer("at").notNull(),
  },
  (t) => [index("sign_in_failures_key").on(t.key, t.at), index("sign_in_failures_at").on(t.at)],
);

export const IP_ACTIONS = [
  "sign_in",
  "sign_in_failed",
  "register",
  "post",
  "thread",
  "conversation_message",
  "profile_post",
  "profile_post_comment",
  "report",
] as const;
export type IpAction = (typeof IP_ACTIONS)[number];
/** What an `ip_log` row's content reference points at (a thread's row points at its first post). */
export const IP_CONTENT_TYPES = [
  "post",
  "conversation_message",
  "profile_post",
  "profile_post_comment",
  "report",
] as const;
export type IpContentType = (typeof IP_CONTENT_TYPES)[number];

/**
 * One row per sign-in (failed ones too), registration, post, thread, conversation message,
 * profile post, comment and report: who, from which address, doing what, and the device the
 * request came from. `ip` is normalised (an IPv4-mapped IPv6 address is stored as IPv4) and
 * `ip_net` is the address for IPv4 and its /64 network for IPv6 (`2001:db8:1:2::/64`), so
 * members behind one connection group together. The raw user agent is never stored. Rows are
 * written in the transaction of the action; erasing a member deletes theirs. Failed sign-ins
 * are never shown by the staff views (they filter on `action`, which the indexes carry, and
 * the network index leaves them out), so a stranger guessing at an account does not tie their
 * address to it.
 */
export const ipLog = sqliteTable(
  "ip_log",
  {
    id: integer("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ip: text("ip").notNull(),
    ipNet: text("ip_net").notNull(),
    action: text("action", { enum: IP_ACTIONS }).notNull(),
    contentType: text("content_type", { enum: IP_CONTENT_TYPES }),
    contentId: integer("content_id"),
    browser: text("browser"),
    os: text("os"),
    deviceType: text("device_type"),
    brand: text("brand"),
    model: text("model"),
    isBot: bool("is_bot").notNull().default(false),
    // Where the request came from, as coarse as the source gives it: the ISO country code, the
    // region and the city. From the proxy's location headers when they are trusted, else from
    // the optional MaxMind database; null when neither is available.
    country: text("country"),
    region: text("region"),
    city: text("city"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    // members.ips: one member's addresses with counts and first/last seen, from the index alone;
    // it also serves the erase, so it holds every row of the member
    index("ip_log_member_ip").on(t.userId, t.ip, t.createdAt, t.action),
    // auth.signInHistory and the new-device check: one member's sign-ins, successful and failed
    index("ip_log_member_sign_in")
      .on(t.userId, t.id)
      .where(sql`action IN ('sign_in', 'sign_in_failed')`),
    // the retention job: the oldest rows first
    index("ip_log_created_at").on(t.createdAt),
    // ips.members: who used an address (or an IPv6 /64), from the index alone
    index("ip_log_net_member")
      .on(t.ipNet, t.userId, t.createdAt, t.action)
      .where(sql`action <> 'sign_in_failed'`),
    // ips.content: the address a piece of content was made from
    index("ip_log_content").on(t.contentType, t.contentId).where(sql`content_id IS NOT NULL`),
  ],
);

/**
 * What the session list shows beyond Better Auth's own session row (which this table never
 * touches): when the session was last used and where it was opened. One row per session, written
 * when it is opened; `last_active_at` is moved forward at most once every few minutes per session
 * (never per request) by a scheduled flush. Deleted with its session.
 */
export const sessionActivity = sqliteTable("session_activity", {
  sessionId: integer("session_id")
    .primaryKey()
    .references(() => auth_session.id, { onDelete: "cascade" }),
  lastActiveAt: integer("last_active_at").notNull(),
  country: text("country"),
  region: text("region"),
  city: text("city"),
});

/**
 * One row per username change a member made themselves (`users.changeUsername`), counted against
 * `profile.renameLimit` within `profile.renameWindowDays`. Changes by staff and erasures are not
 * recorded.
 */
export const usernameChanges = sqliteTable(
  "username_changes",
  {
    id: integer("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    changedAt: integer("changed_at").notNull(),
  },
  (t) => [index("username_changes_member").on(t.userId, t.changedAt)],
);

/**
 * A member's latest cookie choice, kept on the account so it follows them to another device and
 * can be shown to a regulator: the optional categories they accepted (a JSON array of names, none
 * when they refused all), the version of the cookie policy they answered, and when. One row per
 * member, replaced by each new choice; erasing the member deletes it.
 */
export const consentRecords = sqliteTable("consent_records", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  categories: text("categories").notNull(),
  policyVersion: integer("policy_version").notNull(),
  decidedAt: integer("decided_at").notNull(),
});

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
    check("permission_entries_one_target", sql`(group_id = 0) <> (user_id = 0)`),
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

/**
 * Permissions a member holds through a shop item, while it is in their inventory. They resolve
 * as one more layer of the member's combination, beside the member-specific entries. Written
 * only through src/permissions/grants.ts.
 */
export const shopPermissionGrants = sqliteTable(
  "shop_permission_grants",
  {
    id: integer("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    inventoryId: integer("inventory_id").notNull(),
    permissionId: integer("permission_id")
      .notNull()
      .references(() => permissionDefinitions.id),
    /** Flags: 1 (allow). Integers: the value, -1 meaning unlimited. */
    value: integer("value").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("shop_permission_grants_key").on(t.inventoryId, t.permissionId),
    index("shop_permission_grants_user").on(t.userId, t.permissionId),
  ],
);

/** Secondary groups a member holds through a shop item (paid ranks). */
export const shopGroupGrants = sqliteTable(
  "shop_group_grants",
  {
    id: integer("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    inventoryId: integer("inventory_id").notNull(),
    groupId: integer("group_id")
      .notNull()
      .references(() => groups.id),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("shop_group_grants_key").on(t.inventoryId, t.groupId),
    index("shop_group_grants_user").on(t.userId, t.groupId),
    index("shop_group_grants_group").on(t.groupId, t.userId),
  ],
);

// ---------------------------------------------------------------------------
// Promotions

export const promotions = sqliteTable("promotions", {
  id: integer("id").primaryKey(),
  title: text("title").notNull(),
  isActive: bool("is_active").notNull().default(true),
  /** JSON rule `{ match, conditions }` (shared/criteria.ts); at least one condition. */
  rule: text("rule").notNull().default(EMPTY_RULE),
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
    /** A key of the web app's icon set, drawn as a glyph before the title (the uploaded pictures are separate); null for none. */
    iconKey: text("icon_key"),
    coverFileId: integer("cover_file_id"),
    contentUpdatedAt: integer("content_updated_at"),
    requireThreadApproval: bool("require_thread_approval").notNull().default(false),
    requireReplyApproval: bool("require_reply_approval").notNull().default(false),
    isReadOnly: bool("is_read_only").notNull().default(false),
    minAccountAgeDays: counter("min_account_age_days"),
    minPostCount: counter("min_post_count"),
    /** Root categories only: the tab of the forum list the category is shown under. */
    tabId: integer("tab_id"),
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
    /** A catalog_images row of kind thread_cover. */
    coverId: integer("cover_id"),
    prefixId: integer("prefix_id"),
    /** While in the future, lists show the thread highlighted. */
    highlightedUntil: integer("highlighted_until"),
    /** Set when the author bumps the thread: it sorts as if it had a post at that time. */
    bumpedAt: integer("bumped_at"),
    /**
     * What forum lists sort by: the later of the last post and the last bump. Generated, so
     * everything that maintains last_post_at keeps working unchanged.
     */
    sortAt: integer("sort_at").generatedAlwaysAs(
      sql`max(coalesce(last_post_at, 0), coalesce(bumped_at, 0))`,
      { mode: "virtual" },
    ),
  },
  (t) => [
    // threads.list: WHERE node_id = ? AND is_sticky = ? ORDER BY last_post_at DESC, id DESC
    index("threads_node_list").on(t.nodeId, t.isSticky, t.lastPostAt, t.id),
    index("threads_public_feed").on(t.state, desc(t.lastPostAt), desc(t.id)),
    index("threads_node_feed").on(t.nodeId, t.state, desc(t.lastPostAt), desc(t.id)),
    index("threads_state_id").on(t.state, t.id),
    // threads.ranked latestThreads, per forum: WHERE node_id = ? AND state = ? ORDER BY id DESC
    index("threads_node_state_id").on(t.nodeId, t.state, t.id),
    index("threads_user_id").on(t.userId, t.id),
    index("threads_cover").on(t.coverId).where(sql`cover_id IS NOT NULL`),
    // threads.list: WHERE node_id = ? AND is_sticky = ? ORDER BY sort_at DESC, id DESC
    index("threads_node_sort").on(t.nodeId, t.isSticky, t.sortAt, t.id),
    // threads.list filtered by prefix; also "is this prefix in use?".
    index("threads_prefix")
      .on(t.prefixId, t.nodeId, t.isSticky, t.sortAt, t.id)
      .where(sql`prefix_id IS NOT NULL`),
  ],
);

/** Why a thread is featured: a moderator picked it, or its author paid for a promotion. */
export const FEATURE_KINDS = ["staff", "paid"] as const;
export type FeatureKind = (typeof FEATURE_KINDS)[number];

/**
 * A thread featured in Hot and on the home page. A feature counts while `ends_at` is null (a
 * staff pick, until a moderator ends it by setting `ends_at`) or in the future (a paid promotion,
 * 24 hours), so readers need no job to be correct. At most one staff pick per thread is active;
 * a paid promotion is refused while the thread is featured at all. Ended rows are deleted by the
 * rankings job once they are old.
 */
export const threadFeatures = sqliteTable(
  "thread_features",
  {
    id: integer("id").primaryKey(),
    threadId: integer("thread_id")
      .notNull()
      .references(() => threads.id),
    kind: text("kind", { enum: FEATURE_KINDS }).notNull(),
    /** The moderator who picked it, or the member who paid. */
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    startedAt: integer("started_at").notNull(),
    endsAt: integer("ends_at"),
  },
  (t) => [
    // The active features: WHERE ends_at IS NULL OR ends_at > ?; also the cleanup of old rows.
    index("thread_features_end").on(t.endsAt),
    // The features of some threads: WHERE thread_id IN (...) AND (ends_at IS NULL OR ends_at > ?).
    index("thread_features_thread").on(t.threadId, t.endsAt),
    uniqueIndex("thread_features_staff")
      .on(t.threadId)
      .where(sql`kind = 'staff' AND ends_at IS NULL`),
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
     * 0-based position in the thread in creation order (the first post is 0). Hiding, restoring
     * or moving content never changes it (see DECISIONS.md "Post positions"); merging and
     * splitting threads are the only operations that renumber positions.
     */
    position: integer("position").notNull(),
    state: state(),
    createdAt: integer("created_at").notNull(),
    editedAt: integer("edited_at"),
    reactionCounts: reactionCounts(),
    /** The sum of `reaction_counts`, kept equal to it in the same transaction. */
    reactionTotal: counter("reaction_total"),
    attachmentCount: counter("attachment_count"),
  },
  (t) => [
    // posts.list: WHERE thread_id = ? AND position BETWEEN ? AND ? ORDER BY position
    index("posts_thread_position").on(t.threadId, t.position),
    // Counter rebuild: a user's visible posts (joined to their thread's state), index-only.
    index("posts_user").on(t.userId, t.state, t.threadId),
    index("posts_state_id").on(t.state, t.id),
    index("posts_user_id").on(t.userId, t.id),
    // The most-reacted post of a member (criterion most_reacted_post): one seek, only posts with reactions.
    index("posts_user_reactions")
      .on(t.userId, desc(t.reactionTotal))
      .where(sql`reaction_total > 0`),
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
  /** BB code source as written by the author. */
  bodySource: text("body_source").notNull(),
  /** Sanitized HTML rendered from bodySource at write time. */
  bodyHtml: text("body_html").notNull(),
  /**
   * The source without its tags, for the search index. NULL: not computed, the index reads the
   * source; '': a post with no text (a picture only), indexed as empty.
   */
  bodyText: text("body_text"),
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

export const conversations = sqliteTable(
  "conversations",
  {
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
    /** Set by the starter or an administrator; only administrators reply while it is locked. */
    isLocked: bool("is_locked").notNull().default(false),
  },
  (t) => [
    // Daily conversation limit: the date of the member's Nth newest conversation.
    index("conversations_user_created").on(t.userId, t.createdAt),
  ],
);

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
    editedAt: integer("edited_at"),
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
  /** Optional picture drawn instead of the emoji (a public `reaction_image` file). */
  imageFileId: integer("image_file_id"),
  /** Size of one frame of a sprite sheet; null when the whole picture is the frame. */
  frameWidth: integer("frame_width"),
  frameHeight: integer("frame_height"),
  /** Frames of the picture, read left to right, then top to bottom; 1 for a plain image. */
  frameCount: integer("frame_count").notNull().default(1),
  /** JSON rule `{ match, conditions }` for who may give it; only `cheap` criteria. Empty = everyone. */
  rule: text("rule").notNull().default(EMPTY_RULE),
  /** JSON array of forum ids it may be given in; `[]` = everywhere. Elsewhere only when empty. */
  forumIds: text("forum_ids").notNull().default("[]"),
  /** A member the rule excludes does not see the type, instead of seeing it locked. */
  hideWhenLocked: bool("hide_when_locked").notNull().default(false),
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
    // Reactions given and received, by type (criteria reactions_given_by_type / _received_by_type).
    index("reactions_user_type").on(t.userId, t.reactionTypeId),
    index("reactions_recipient_type").on(t.contentUserId, t.reactionTypeId),
    // Counter rebuild: the reaction score a user received, index-only.
    index("reactions_recipient").on(t.contentUserId, t.score),
    // Daily negative-reaction limit: negative reactions a member gave since a time. Partial, so
    // the common positive reaction pays nothing for it.
    index("reactions_negative_given").on(t.userId, t.createdAt).where(sql`score < 0`),
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
    // admin.jobs: the latest failures.
    index("jobs_failed_updated").on(t.updatedAt).where(sql`status = 'failed'`),
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
    /** JSON measured at upload; for a frame, its opening (modules/images/frame-geometry.ts). */
    meta: text("meta"),
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
    index("attachments_type_id").on(t.contentType, t.id),
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

/** What a warning type may do automatically once a member's active points reach a threshold. */
export const WARNING_ACTION_KINDS = ["ban", "group", "restriction"] as const;
export type WarningActionKind = (typeof WARNING_ACTION_KINDS)[number];

/**
 * A kind of warning a moderator picks: default points and expiry (null = never) and reason, the
 * name in each language. `locked` fixes points and expiry for the moderator.
 */
export const warningTypes = sqliteTable("warning_types", {
  id: integer("id").primaryKey(),
  nameEn: text("name_en").notNull(),
  nameEs: text("name_es").notNull(),
  points: integer("points").notNull(),
  expiryDays: integer("expiry_days"),
  defaultReason: text("default_reason").notNull().default(""),
  locked: bool("locked").notNull().default(false),
  createdAt: integer("created_at").notNull(),
  /** Set when deletion began: the type is gone for everyone and a job is forgetting its warnings. */
  deletedAt: integer("deleted_at"),
});

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
    /** The type the moderator picked; null for a custom warning or after the type was deleted. */
    typeId: integer("type_id").references(() => warningTypes.id, { onDelete: "set null" }),
  },
  (t) => [
    index("warnings_user_expiry").on(t.userId, t.expiresAt, t.id),
    index("warnings_type").on(t.typeId).where(sql`type_id IS NOT NULL`),
  ],
);

/**
 * An automatic action: when a member's active warning points reach `threshold` the action is
 * applied once. `days` null = permanent. `groupId` is set for kind group, `restrictionKind`
 * for kind restriction.
 */
export const warningActions = sqliteTable(
  "warning_actions",
  {
    id: integer("id").primaryKey(),
    threshold: integer("threshold").notNull(),
    kind: text("kind", { enum: WARNING_ACTION_KINDS }).notNull(),
    days: integer("days"),
    groupId: integer("group_id").references(() => groups.id),
    restrictionKind: text("restriction_kind", { enum: RESTRICTION_KINDS }),
    createdAt: integer("created_at").notNull(),
    /** Set when deletion began: the action no longer fires and a job is taking its groups back. */
    deletedAt: integer("deleted_at"),
  },
  (t) => [index("warning_actions_threshold").on(t.threshold, t.id)],
);

/**
 * One row while an action is in effect for a member (applied at a crossing, removed when their
 * points fall below the threshold again). `groupAddedAt` is the `created_at` of the
 * `user_groups` row the action added and may lift; null when it added nothing it may lift.
 * `groupEndsAt` is when a timed group ends by itself.
 */
export const warningActionFires = sqliteTable(
  "warning_action_fires",
  {
    id: integer("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    actionId: integer("action_id")
      .notNull()
      .references(() => warningActions.id, { onDelete: "cascade" }),
    firedAt: integer("fired_at").notNull(),
    groupId: integer("group_id"),
    groupAddedAt: integer("group_added_at"),
    groupEndsAt: integer("group_ends_at"),
    /** The warning that fired the action told the member; the group's removal tells them too. */
    notify: bool("notify").notNull().default(true),
  },
  (t) => [
    uniqueIndex("warning_action_fires_member").on(t.userId, t.actionId),
    index("warning_action_fires_action").on(t.actionId),
    index("warning_action_fires_ends").on(t.groupEndsAt).where(sql`group_ends_at IS NOT NULL`),
  ],
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

/** Events whose public URLs still have to be submitted to IndexNow (see migration 0009). */
export const indexnowPending = sqliteTable("indexnow_pending", {
  eventId: integer("event_id")
    .primaryKey()
    .references(() => domainEvents.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  createdAt: integer("created_at").notNull(),
});

/** Threads with a merge or split transfer pending or failed; guards replies and reorganization. */
export const threadTransfers = sqliteTable(
  "thread_transfers",
  {
    id: integer("id").primaryKey(),
    threadId: integer("thread_id")
      .notNull()
      .references(() => threads.id),
    role: text("role", {
      enum: ["merge_target", "merge_source", "split_source", "split_target"],
    }).notNull(),
    otherThreadId: integer("other_thread_id").notNull(),
    jobKey: text("job_key").notNull(),
    createdAt: integer("created_at").notNull(),
    failedAt: integer("failed_at"),
  },
  (t) => [uniqueIndex("thread_transfers_thread").on(t.threadId)],
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
    // Times a member was quoted (criterion quoted_by_others).
    index("content_quotes_quoted_user").on(t.quotedUserId, t.contentType, t.contentId),
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
    /** When the email for this row was sent; a grouped row is emailed at most once. */
    emailSentAt: integer("email_sent_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    readAt: integer("read_at"),
  },
  (t) => [
    index("notifications_user_recent").on(t.userId, t.updatedAt, t.id),
    uniqueIndex("notifications_user_group")
      .on(t.userId, t.epoch, t.groupKey)
      .where(sql`read_at IS NULL AND group_key IS NOT NULL`),
    index("notifications_user_unread").on(t.userId, t.id).where(sql`read_at IS NULL`),
    index("notifications_user_thread")
      .on(t.userId, t.threadId)
      .where(sql`read_at IS NULL AND thread_id IS NOT NULL`),
    index("notifications_content").on(t.contentType, t.contentId),
    index("notifications_read_purge").on(t.readAt, t.id).where(sql`read_at IS NOT NULL`),
    index("notifications_thread").on(t.threadId, t.id).where(sql`thread_id IS NOT NULL`),
    index("notifications_user_unread_recent")
      .on(t.userId, t.epoch, t.updatedAt, t.id)
      .where(sql`read_at IS NULL`),
    // The standing sign-up alerts still unread, to clear them once nobody waits: a handful of rows.
    index("notifications_signup_alert")
      .on(t.id)
      .where(sql`type = 'moderator.signup' AND read_at IS NULL`),
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
  /** Site-relative path or http(s) address the alert opens; null opens the alert list. */
  url: text("url"),
  audience: text("audience", { enum: ANNOUNCEMENT_AUDIENCES }).notNull().default("all"),
  /** The group of audience `group` (primary or secondary members). */
  audienceGroupId: integer("audience_group_id"),
  /** JSON array of member ids for audience `users`. */
  audienceUserIds: text("audience_user_ids").notNull().default("[]"),
});

/**
 * Site-wide banners. Shown between `starts_at` and `ends_at` (either may be null: no bound) to
 * their audience, newest first; a dismissible one stays hidden for a member who dismissed it.
 */
export const notices = sqliteTable("notices", {
  id: integer("id").primaryKey(),
  title: text("title").notNull(),
  bodySource: text("body_source").notNull(),
  bodyHtml: text("body_html").notNull(),
  /** JSON rule `{ match, conditions }` for who sees it; only `cheap` criteria. */
  rule: text("rule").notNull().default(EMPTY_RULE),
  dismissible: bool("dismissible").notNull().default(true),
  active: bool("active").notNull().default(true),
  startsAt: integer("starts_at"),
  endsAt: integer("ends_at"),
  createdBy: integer("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const noticeDismissals = sqliteTable(
  "notice_dismissals",
  {
    id: integer("id").primaryKey(),
    noticeId: integer("notice_id")
      .notNull()
      .references(() => notices.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    dismissedAt: integer("dismissed_at").notNull(),
  },
  (t) => [uniqueIndex("notice_dismissals_user_notice").on(t.userId, t.noticeId)],
);

/**
 * A member's bookmarks of threads, posts and conversations. No foreign key on `content_id`:
 * listing checks that the viewer can still see each item and skips the rest.
 */
export const bookmarks = sqliteTable(
  "bookmarks",
  {
    id: integer("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contentType: text("content_type", { enum: BOOKMARK_CONTENT_TYPES }).notNull(),
    contentId: integer("content_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("bookmarks_user_content").on(t.userId, t.contentType, t.contentId),
    // bookmarks.list: WHERE user_id = ? ORDER BY id DESC
    index("bookmarks_user").on(t.userId, t.id),
  ],
);

/**
 * The content of each `[SPOILER]`/`[ISPOILER]` in a body, rendered at write time and kept out of
 * `body_html`, which holds only a placeholder naming `position` (0-based, in source order).
 * Rewritten with the body on every edit.
 */
export const contentSpoilers = sqliteTable(
  "content_spoilers",
  {
    id: integer("id").primaryKey(),
    contentType: text("content_type", { enum: SPOILER_CONTENT_TYPES }).notNull(),
    contentId: integer("content_id").notNull(),
    position: integer("position").notNull(),
    html: text("html").notNull(),
  },
  (t) => [uniqueIndex("content_spoilers_content").on(t.contentType, t.contentId, t.position)],
);

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

// ---------------------------------------------------------------------------
// Credits

/**
 * The credit ledger: one row per balance change, written in the same transaction as
 * users.credits (see shared/credits.ts, the only writer). Rows are never updated or deleted.
 */
export const creditTransactions = sqliteTable(
  "credit_transactions",
  {
    id: integer("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Signed, never 0. */
    amount: integer("amount").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    type: text("type", { enum: CREDIT_TRANSACTION_TYPES }).notNull(),
    /** What caused it, as a generic reference (e.g. "shop_purchase" 12); null for none. */
    sourceType: text("source_type"),
    sourceId: integer("source_id"),
    /** Who did it; null for the system. */
    actorId: integer("actor_id"),
    reason: text("reason").notNull().default(""),
    createdAt: integer("created_at").notNull(),
  },
  // A member's history, newest first; the staff ledger of everyone walks the primary key.
  (t) => [
    index("credit_transactions_user").on(t.userId, t.id),
    // Credits earned in a window (criterion credits_earned): covering, a range on created_at.
    index("credit_transactions_user_created").on(t.userId, t.createdAt, t.type, t.amount),
    // admin.activity: the manual adjustments of the last days.
    index("credit_transactions_adjustment").on(t.createdAt).where(sql`type = 'adjustment'`),
  ],
);

/**
 * "When <trigger> happens, the member gains or loses <amount>." Ids are never reused
 * (AUTOINCREMENT), so applications of a deleted rule can never be mistaken for a later rule's.
 */
export const creditRules = sqliteTable("credit_rules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  trigger: text("trigger", { enum: CREDIT_TRIGGERS }).notNull(),
  amount: integer("amount").notNull(),
  isActive: bool("is_active").notNull().default(true),
  /** At most this many applications per member within the window; null = no limit. */
  limitCount: integer("limit_count"),
  limitWindowHours: integer("limit_window_hours"),
  /** JSON array of forum ids the rule is restricted to; empty = everywhere. */
  nodeIds: text("node_ids").notNull().default("[]"),
  /**
   * The newest domain event when the rule was created. The rule applies only to later events,
   * so events still waiting to be processed, or replayed, never pay under a rule made after them.
   */
  createdAfterEventId: integer("created_after_event_id").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/**
 * One row per (rule, member, source): the unique key is what makes event processing
 * idempotent. The source is the content, member, warning, award grant or day the rule paid for;
 * `source_user_id` is the other member involved (the reactor, the follower), 0 for none.
 * Hiding the source content flips the row to `reverted` and restoring it flips it back, each
 * with a ledger row of the stored amount; `last_event_id` ignores replays of older events.
 */
export const creditRuleApplications = sqliteTable(
  "credit_rule_applications",
  {
    id: integer("id").primaryKey(),
    ruleId: integer("rule_id").notNull(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    sourceId: integer("source_id").notNull(),
    sourceUserId: integer("source_user_id").notNull().default(0),
    /** The rule's amount when it was applied; reversals use it, whatever the rule says now. */
    amount: integer("amount").notNull(),
    state: text("state", { enum: CREDIT_APPLICATION_STATES }).notNull().default("applied"),
    lastEventId: integer("last_event_id").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("credit_rule_applications_key").on(
      t.ruleId,
      t.userId,
      t.sourceType,
      t.sourceId,
      t.sourceUserId,
    ),
    // Everything a piece of content paid, to revert or re-apply it in id order.
    index("credit_rule_applications_source").on(t.sourceType, t.sourceId),
    // Whether a rule already paid someone for a source.
    index("credit_rule_applications_paid").on(t.sourceType, t.sourceId, t.ruleId, t.sourceUserId),
    // The per-member limit: applications of a rule within its window.
    index("credit_rule_applications_limit").on(t.ruleId, t.userId, t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Awards

export const awards = sqliteTable("awards", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  /** An icon key or URL the client resolves; opaque to the server. */
  icon: text("icon").notNull().default(""),
  tier: text("tier", { enum: AWARD_TIERS }).notNull(),
  xp: integer("xp").notNull().default(0),
  /** Credits paid through the ledger with each grant. */
  credits: integer("credits").notNull().default(0),
  /** Whether a member can hold it more than once. */
  isStackable: bool("is_stackable").notNull().default(false),
  isActive: bool("is_active").notNull().default(true),
  /** JSON rule `{ match, conditions }` (shared/criteria.ts); no conditions = granted by hand only. */
  rule: text("rule").notNull().default(EMPTY_RULE),
  /** Grants currently held, over all members. */
  grantCount: counter("grant_count"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  imageFileId: integer("image_file_id"),
});

/** One row per grant. A revoked grant keeps its row, so ids are never reused. */
export const memberAwards = sqliteTable(
  "member_awards",
  {
    id: integer("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    awardId: integer("award_id")
      .notNull()
      .references(() => awards.id),
    /** Null for an automatic grant. */
    grantedBy: integer("granted_by"),
    reason: text("reason").notNull().default(""),
    /** The award's XP and credits when it was granted; revoking takes back exactly these. */
    xp: integer("xp").notNull(),
    credits: integer("credits").notNull(),
    createdAt: integer("created_at").notNull(),
    revokedAt: integer("revoked_at"),
    revokedBy: integer("revoked_by"),
  },
  (t) => [
    // A member's held grants (revoked_at IS NULL), newest first.
    index("member_awards_user").on(t.userId, t.revokedAt, t.id),
    // An award's holders, newest first.
    index("member_awards_award").on(t.awardId, t.revokedAt, t.id),
  ],
);

/**
 * Held grants per member and award, for listings. The row outlives its grants: `auto_granted`
 * records that the criteria already granted the award once, so revoking it is final.
 */
export const memberAwardTotals = sqliteTable(
  "member_award_totals",
  {
    id: integer("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    awardId: integer("award_id")
      .notNull()
      .references(() => awards.id),
    count: counter("count"),
    autoGranted: bool("auto_granted").notNull().default(false),
    lastGrantedAt: integer("last_granted_at"),
  },
  (t) => [
    uniqueIndex("member_award_totals_user_award").on(t.userId, t.awardId),
    // Whether any member holds an award more than once (it then stays stackable).
    index("member_award_totals_award").on(t.awardId, t.count),
  ],
);

// ---------------------------------------------------------------------------
// Shop

export const shopCategories = sqliteTable("shop_categories", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  position: integer("position").notNull().default(0),
  isActive: bool("is_active").notNull().default(true),
  /** JSON rule for who sees and may buy from it; no conditions = everyone. */
  rule: text("rule").notNull().default(EMPTY_RULE),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const shopItems = sqliteTable(
  "shop_items",
  {
    id: integer("id").primaryKey(),
    categoryId: integer("category_id")
      .notNull()
      .references(() => shopCategories.id),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    icon: text("icon").notNull().default(""),
    price: integer("price").notNull(),
    isActive: bool("is_active").notNull().default(true),
    /** Units left; null = unlimited. */
    stock: integer("stock"),
    /** Held in a quantity and used up one unit at a time; otherwise bought once. */
    isConsumable: bool("is_consumable").notNull().default(false),
    isGiftable: bool("is_giftable").notNull().default(false),
    /** How long a non-consumable item lasts from purchase; null = permanent. */
    durationSeconds: integer("duration_seconds"),
    /** JSON, validated by the ShopEffect contract. */
    effect: text("effect").notNull(),
    position: integer("position").notNull().default(0),
    /** JSON rule for who sees and may buy it; no conditions = everyone. */
    rule: text("rule").notNull().default(EMPTY_RULE),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    imageFileId: integer("image_file_id"),
  },
  // The catalog: a category's items in display order.
  (t) => [index("shop_items_category").on(t.categoryId, t.position, t.id)],
);

/** What a member holds: one row per member and item. */
export const shopInventory = sqliteTable(
  "shop_inventory",
  {
    id: integer("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    itemId: integer("item_id")
      .notNull()
      .references(() => shopItems.id),
    state: text("state", { enum: SHOP_INVENTORY_STATES }).notNull(),
    /** Units left of a consumable; 1 for other items. */
    quantity: integer("quantity").notNull().default(1),
    /** End of a temporary item; null = permanent. */
    expiresAt: integer("expires_at"),
    /** What the member paid for what they hold (an upgrade carries the credit over); sets the credit of a later upgrade. */
    paidPrice: integer("paid_price").notNull().default(0),
    acquiredAt: integer("acquired_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("shop_inventory_user_item").on(t.userId, t.itemId),
    // A member's inventory by state, most recently changed first.
    index("shop_inventory_user_state").on(t.userId, t.state, t.updatedAt, t.id),
    // The expiry job: active items whose end has passed.
    index("shop_inventory_expiry").on(t.state, t.expiresAt),
    // Deleting an item checks that no inventory row refers to it.
    index("shop_inventory_item").on(t.itemId),
  ],
);

/** The purchase log. The buyer pays; the recipient (the buyer, unless it is a gift) receives. */
export const shopPurchases = sqliteTable(
  "shop_purchases",
  {
    id: integer("id").primaryKey(),
    itemId: integer("item_id")
      .notNull()
      .references(() => shopItems.id),
    buyerId: integer("buyer_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recipientId: integer("recipient_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull().default(1),
    /** Total paid. */
    price: integer("price").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("shop_purchases_buyer").on(t.buyerId, t.id),
    // "Has bought item X" (criteria), and the log filtered by buyer and item.
    index("shop_purchases_buyer_item").on(t.buyerId, t.itemId),
    index("shop_purchases_item").on(t.itemId, t.id),
  ],
);

// ---------------------------------------------------------------------------
// Appearance catalogs

/**
 * Pictures members choose from: avatar frames, profile covers, thread covers. An entry without a
 * file is waiting for its picture and cannot be active.
 */
export const catalogImages = sqliteTable(
  "catalog_images",
  {
    id: integer("id").primaryKey(),
    kind: text("kind", { enum: CATALOG_IMAGE_KINDS }).notNull(),
    name: text("name").notNull(),
    fileId: integer("file_id").references(() => files.id),
    /**
     * Frames only: where the frame sits around the avatar box, in percent of the box (frame
     * width, left and top offsets), and how far the picture shrinks into the opening.
     */
    frameWidth: real("frame_width"),
    frameLeft: real("frame_left"),
    frameTop: real("frame_top"),
    frameScale: real("frame_scale"),
    position: integer("position").notNull().default(0),
    isActive: bool("is_active").notNull().default(true),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  // A catalog in display order.
  (t) => [index("catalog_images_kind").on(t.kind, t.position, t.id)],
);

/** Colours administrators define: accents (with a foreground), name colours, prefix colours. */
export const paletteColors = sqliteTable(
  "palette_colors",
  {
    id: integer("id").primaryKey(),
    kind: text("kind", { enum: PALETTE_KINDS }).notNull(),
    name: text("name").notNull(),
    /** #rrggbb. */
    color: text("color").notNull(),
    /** Accents only: the colour of text drawn on the accent. */
    foreground: text("foreground"),
    position: integer("position").notNull().default(0),
    isActive: bool("is_active").notNull().default(true),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("palette_colors_kind").on(t.kind, t.position, t.id)],
);

// ---------------------------------------------------------------------------
// Forum presentation

/** Labels an author can put in front of a thread title. The colour is a palette_colors row. */
export const threadPrefixes = sqliteTable(
  "thread_prefixes",
  {
    id: integer("id").primaryKey(),
    label: text("label").notNull(),
    colorId: integer("color_id")
      .notNull()
      .references(() => paletteColors.id),
    /** An icon key the client resolves from its interface icon set; opaque to the server. */
    icon: text("icon").notNull().default(""),
    position: integer("position").notNull().default(0),
    isActive: bool("is_active").notNull().default(true),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("thread_prefixes_position").on(t.position, t.id),
    // "Is this colour in use?" before a palette colour is deleted.
    index("thread_prefixes_color").on(t.colorId),
  ],
);

/** The tabs of the forum list. A root category belongs to one, or to none (shown under all). */
export const forumTabs = sqliteTable(
  "forum_tabs",
  {
    id: integer("id").primaryKey(),
    title: text("title").notNull(),
    position: integer("position").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("forum_tabs_position").on(t.position, t.id)],
);

/**
 * A tag (hashtag): `name` is the key, NFC and lowercase, 1-50 letters, numbers and `_`.
 * `thread_count` counts every row of thread_tags of the tag, whatever the thread's state (a
 * trigger keeps it); it is only a first filter, who may see what is decided at read time.
 */
export const tags = sqliteTable(
  "tags",
  {
    id: integer("id").primaryKey(),
    name: text("name").notNull(),
    threadCount: counter("thread_count"),
    createdBy: integer("created_by"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("tags_name").on(t.name)],
);

/** Old names of a renamed or merged tag: stored links and typed hashtags still reach it. */
export const tagAliases = sqliteTable(
  "tag_aliases",
  {
    id: integer("id").primaryKey(),
    name: text("name").notNull(),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("tag_aliases_name").on(t.name), index("tag_aliases_tag").on(t.tagId)],
);

/**
 * The tags of a thread. `from_post` marks the ones the opening post's hashtags put there (an
 * edit of that post takes them off again). Copies of the thread's own columns, kept by triggers,
 * let the tag page seek what a viewer may see without reading every thread: `sort_at`
 * (threads.sort_at), `vis` (the thread's state: 1 visible, 2 held for approval, 3 deleted or
 * merged away), `node_id` and `author_id`. Triggers also keep tags.thread_count and
 * users.tag_count (which counts only the rows of visible threads).
 */
export const threadTags = sqliteTable(
  "thread_tags",
  {
    id: integer("id").primaryKey(),
    threadId: integer("thread_id")
      .notNull()
      .references(() => threads.id),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tags.id),
    addedBy: integer("added_by"),
    fromPost: bool("from_post").notNull().default(false),
    sortAt: integer("sort_at").notNull(),
    vis: integer("vis").notNull().default(1),
    nodeId: integer("node_id").notNull(),
    authorId: integer("author_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("thread_tags_thread_tag").on(t.threadId, t.tagId),
    // The tag page: WHERE tag_id = ? AND vis = ? ORDER BY sort_at DESC, thread_id DESC.
    index("thread_tags_hub").on(t.tagId, t.vis, t.sortAt, t.threadId),
    // The author's own threads of a tag in a state (their held ones; the ones they may read).
    index("thread_tags_author").on(t.tagId, t.authorId, t.vis, t.sortAt, t.threadId),
    // Does the tag have a visible thread in these forums (with or without the opening post's tags)?
    index("thread_tags_node").on(t.tagId, t.vis, t.nodeId, t.fromPost),
  ],
);

export const POLL_KINDS = ["poll", "quiz"] as const;
export type PollKind = (typeof POLL_KINDS)[number];
/** When the results are shown: at all times, once the viewer has voted, or once the poll is closed. */
export const POLL_RESULTS = ["always", "after_vote", "after_close"] as const;
export type PollResultsMode = (typeof POLL_RESULTS)[number];

/**
 * A poll (one question) or a quiz (a series of questions) of a thread; a thread has at most one.
 * Open until `closed_at` (closed by hand) or `closes_at` (the close date) has passed. Whether
 * voters are public (`anonymous`) is fixed when the poll is made. `ballot_count` is the number of
 * members who took part (rows of poll_ballots) and `search_text` the question text the search
 * index reads with the thread's opening post; triggers keep both.
 */
export const polls = sqliteTable(
  "polls",
  {
    id: integer("id").primaryKey(),
    threadId: integer("thread_id")
      .notNull()
      .references(() => threads.id),
    /** Who made it: the thread's author, or staff who added it later. */
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind", { enum: POLL_KINDS }).notNull().default("poll"),
    anonymous: bool("anonymous").notNull().default(false),
    /** Answers one vote may pick (a quiz answers one per question). */
    maxChoices: integer("max_choices").notNull().default(1),
    allowCustom: bool("allow_custom").notNull().default(false),
    allowChange: bool("allow_change").notNull().default(true),
    results: text("results", { enum: POLL_RESULTS }).notNull().default("always"),
    closesAt: integer("closes_at"),
    closedAt: integer("closed_at"),
    ballotCount: counter("ballot_count"),
    searchText: text("search_text").notNull().default(""),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("polls_thread").on(t.threadId)],
);

/** A question of a poll or quiz, with an optional picture (a file attached to the poll). */
export const pollQuestions = sqliteTable(
  "poll_questions",
  {
    id: integer("id").primaryKey(),
    pollId: integer("poll_id")
      .notNull()
      .references(() => polls.id),
    position: integer("position").notNull(),
    text: text("text").notNull(),
    /** Shown after a quiz question is answered. */
    explanation: text("explanation").notNull().default(""),
    imageFileId: integer("image_file_id"),
  },
  (t) => [index("poll_questions_poll").on(t.pollId, t.position, t.id)],
);

/**
 * An answer a voter can pick. `vote_count` is kept by triggers on poll_votes; `is_correct` is a
 * quiz's right answer (one per question) and is never sent before the viewer answers; `added_by`
 * is the member who added a custom answer.
 */
export const pollAnswers = sqliteTable(
  "poll_answers",
  {
    id: integer("id").primaryKey(),
    pollId: integer("poll_id")
      .notNull()
      .references(() => polls.id),
    questionId: integer("question_id").notNull(),
    position: integer("position").notNull(),
    text: text("text").notNull(),
    imageFileId: integer("image_file_id"),
    isCorrect: bool("is_correct").notNull().default(false),
    voteCount: counter("vote_count"),
    addedBy: integer("added_by"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("poll_answers_poll").on(t.pollId, t.questionId, t.position, t.id)],
);

/**
 * One row per (answer, member): a poll voter's choices, a quiz taker's answers. Anonymous polls
 * keep the rows (a vote needs its voter to be changed or refused twice) and never return them.
 */
export const pollVotes = sqliteTable(
  "poll_votes",
  {
    id: integer("id").primaryKey(),
    pollId: integer("poll_id")
      .notNull()
      .references(() => polls.id),
    questionId: integer("question_id").notNull(),
    answerId: integer("answer_id")
      .notNull()
      .references(() => pollAnswers.id),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("poll_votes_answer_member").on(t.answerId, t.userId),
    // The viewer's own choices in the polls of a page.
    index("poll_votes_member").on(t.pollId, t.userId),
  ],
);

/**
 * One row per member who took part in a poll or quiz: the single place that says whether they
 * did (`polls.ballot_count` and `users.poll_vote_count` are kept by triggers on it). For a quiz
 * `answered` and `score` are the member's result and `completed_at` is set with the last answer.
 */
export const pollBallots = sqliteTable(
  "poll_ballots",
  {
    id: integer("id").primaryKey(),
    pollId: integer("poll_id")
      .notNull()
      .references(() => polls.id),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    answered: counter("answered"),
    score: counter("score"),
    createdAt: integer("created_at").notNull(),
    completedAt: integer("completed_at"),
  },
  (t) => [uniqueIndex("poll_ballots_member").on(t.pollId, t.userId)],
);

export const RANKING_KINDS = ["mostReplied", "mostReacted", "mostViewed", "hot"] as const;

/**
 * Rankings a background job recomputes, kept PER FORUM: the best threads of each forum by
 * replies, by reactions on the opening post, by views and by hot score (target = thread id;
 * the hot score is stored multiplied by a million). A reader merges the rankings of the
 * forums the viewer can see, so a forum the viewer cannot see neither shows up nor pushes
 * anything out.
 */
export const rankings = sqliteTable(
  "rankings",
  {
    id: integer("id").primaryKey(),
    kind: text("kind", { enum: RANKING_KINDS }).notNull(),
    nodeId: integer("node_id").notNull(),
    position: integer("position").notNull(),
    targetId: integer("target_id").notNull(),
    score: integer("score").notNull(),
  },
  (t) => [uniqueIndex("rankings_kind_node_position").on(t.kind, t.nodeId, t.position)],
);

// ---------------------------------------------------------------------------
// Site chrome

export const NAVIGATION_LOCATIONS = ["header", "mobile", "account", "footer"] as const;
export const NAVIGATION_AUDIENCES = ["everyone", "guests", "members", "permission"] as const;
export const NAVIGATION_ICON_POSITIONS = ["before", "after"] as const;

/**
 * The links of the public site. Two levels: a top-level entry and its children, in one location.
 * Rows with `builtin` set ship with the site and are never deleted.
 */
export const navigationEntries = sqliteTable(
  "navigation_entries",
  {
    id: integer("id").primaryKey(),
    location: text("location", { enum: NAVIGATION_LOCATIONS }).notNull(),
    parentId: integer("parent_id"),
    title: text("title").notNull(),
    /** A path of the site or an http(s) URL; null on a heading that only groups its children. */
    target: text("target"),
    position: integer("position").notNull().default(0),
    isEnabled: bool("is_enabled").notNull().default(true),
    audience: text("audience", { enum: NAVIGATION_AUDIENCES }).notNull().default("everyone"),
    /** With audience `permission`: the id of a global permission. */
    permission: text("permission"),
    /** A key of the web app's icon set drawn next to the title; null for none. */
    icon: text("icon"),
    /** Whether the icon sits before or after the title. */
    iconPosition: text("icon_position", { enum: NAVIGATION_ICON_POSITIONS })
      .notNull()
      .default("before"),
    /** A stable key on the entries the site ships with; null on the ones an administrator adds. */
    builtin: text("builtin"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("navigation_entries_order").on(t.location, t.parentId, t.position, t.id),
    uniqueIndex("navigation_entries_builtin").on(t.builtin).where(sql`builtin IS NOT NULL`),
  ],
);

/** Pages of text the site publishes about itself (terms, privacy, ...), written in Markdown. */
export const staticPages = sqliteTable(
  "static_pages",
  {
    id: integer("id").primaryKey(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    bodySource: text("body_source").notNull(),
    bodyHtml: text("body_html").notNull(),
    isPublished: bool("is_published").notNull().default(true),
    /**
     * Raised only when an administrator publishes the page as a new version. For the `terms` and
     * `rules` pages it is the version members must have accepted (see `terms_acceptances`).
     */
    version: integer("version").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("static_pages_slug").on(t.slug)],
);

/** The static pages members must accept; the page's slug is the kind. */
export const ACCEPTANCE_KINDS = ["terms", "rules"] as const;
export type AcceptanceKind = (typeof ACCEPTANCE_KINDS)[number];

/**
 * One row per acceptance: which version of the terms page or the rules page a member accepted,
 * when, and from which address (the trusted client address, normalised; null when the request
 * carried none). Written at sign-up and when the member accepts on the prompt. A member has
 * accepted the current version of a kind when they hold a row of that kind at that version or
 * a later one. Deleted with the member (the erase also deletes it, because an erased member's
 * row stays).
 */
export const termsAcceptances = sqliteTable(
  "terms_acceptances",
  {
    id: integer("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ACCEPTANCE_KINDS }).notNull(),
    version: integer("version").notNull(),
    ip: text("ip"),
    acceptedAt: integer("accepted_at").notNull(),
  },
  (t) => [
    // One acceptance per member, kind and version; also the lookup of a member's newest version.
    uniqueIndex("terms_acceptances_member").on(t.userId, t.kind, t.version),
    // The retention job's walk over the rows that still hold an address.
    index("terms_acceptances_with_ip").on(t.id).where(sql`ip IS NOT NULL`),
  ],
);

// ---------------------------------------------------------------------------
// Member of the month

/**
 * What each member did in one calendar month (UTC), recomputed by a background job for the
 * month in progress and fixed when the month ends. `month` is year * 100 + month (202610).
 * `points_tenths` is the score times ten, so it sorts as an integer.
 */
export const memberMonthStats = sqliteTable(
  "member_month_stats",
  {
    id: integer("id").primaryKey(),
    month: integer("month").notNull(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    posts: integer("posts").notNull().default(0),
    reactions: integer("reactions").notNull().default(0),
    referrals: integer("referrals").notNull().default(0),
    pointsTenths: integer("points_tenths").notNull().default(0),
  },
  (t) => [
    uniqueIndex("member_month_stats_member").on(t.month, t.userId),
    // standings.month: WHERE month = ? ORDER BY points_tenths DESC, posts DESC, user_id
    index("member_month_stats_standing").on(t.month, desc(t.pointsTenths), desc(t.posts), t.userId),
  ],
);

/** The member of the month of each finished month that had one. Never rewritten. */
export const monthWinners = sqliteTable("month_winners", {
  /** year * 100 + month. */
  month: integer("month").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  posts: integer("posts").notNull(),
  reactions: integer("reactions").notNull(),
  referrals: integer("referrals").notNull(),
  pointsTenths: integer("points_tenths").notNull(),
  decidedAt: integer("decided_at").notNull(),
});
