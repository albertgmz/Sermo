import type { BuiltinGroup, RestrictionKind } from "../db/schema";

/**
 * The single list of everything that can be permitted. Services decide through `can()` and
 * friends with these ids; the admin API lists and edits permissions straight from here.
 *
 * Adding a permission: add an entry, then call `can()` with its id. On startup the registry
 * sync stores the definition and applies `defaults` to the built-in groups, once.
 */

/** A default for one built-in group. Omitted means unset (denied unless another group allows). */
export type FlagDefault = "allow" | "never";

/** Legacy group flag (groups table columns) a permission was translated from. */
export type LegacyFlag =
  | "is_admin"
  | "is_moderator"
  | "can_view_nodes"
  | "can_post"
  | "can_view_profiles"
  | "can_post_profile"
  | "can_start_conversations"
  | "can_react";

interface BaseDefinition {
  readonly scope: "global" | "node";
  /** Admin UI grouping. */
  readonly category:
    | "general"
    | "forum"
    | "profile"
    | "conversation"
    | "moderation"
    | "economy"
    | "admin";
  /** Translated from this legacy group flag (node overrides follow the flag's node column). */
  readonly legacy?: LegacyFlag;
}

export interface FlagDefinition extends BaseDefinition {
  readonly type: "flag";
  readonly defaults: Partial<Record<BuiltinGroup, FlagDefault>>;
  /** Guests never have it, whatever the entries say. */
  readonly requiresAccount?: boolean;
  /** An active restriction of this kind denies it. */
  readonly restriction?: RestrictionKind;
  /** Granted only for content owned by the actor: the context must carry `ownerId`. */
  readonly own?: boolean;
  /**
   * Integer permission holding a time window in minutes (-1 unlimited) measured from the
   * content's `createdAt`, within which this own-content permission applies.
   */
  readonly timeLimit?: string;
  /** The context's `target` member must rank strictly below the actor. */
  readonly hierarchy?: boolean;
  /** The context must say whether the actor is banned from the thread (`threadBanned`). */
  readonly threadBan?: boolean;
  /**
   * A read gate that restricts by denial: granted unless some group of the member says never, so
   * a group made by hand (or a member whose groups hold no entry) is not locked out.
   */
  readonly defaultAllow?: boolean;
}

export interface IntegerDefinition extends BaseDefinition {
  readonly type: "integer";
  /** -1 means unlimited. */
  readonly defaults: Partial<Record<BuiltinGroup, number>>;
  /**
   * What the member resolves to when none of their groups holds an entry (0 when omitted): for a
   * limit on an action another permission grants, the built-in bound, so a group made by hand
   * that holds the action is neither locked out nor unbounded.
   */
  readonly unset?: number;
  readonly unit: "bytes" | "minutes" | "count";
}

export type PermissionDefinition = FlagDefinition | IntegerDefinition;

/** Every group except guests. */
const MEMBERS = {
  unconfirmed: "allow",
  registered: "allow",
  moderator: "allow",
  admin: "allow",
} as const satisfies Partial<Record<BuiltinGroup, FlagDefault>>;
const EVERYONE = { guest: "allow", ...MEMBERS } as const;
const POSTERS = { registered: "allow", moderator: "allow", admin: "allow" } as const;
const STAFF = { moderator: "allow", admin: "allow" } as const;
const ADMINS = { admin: "allow" } as const;
const MEMBERS_UNLIMITED = { unconfirmed: -1, registered: -1, moderator: -1, admin: -1 };

const nodeModerator = (category: "forum" = "forum"): FlagDefinition => ({
  scope: "node",
  category,
  type: "flag",
  defaults: STAFF,
  requiresAccount: true,
  legacy: "is_moderator",
});

export const PERMISSIONS = {
  // General -----------------------------------------------------------------------------
  "profile.view": {
    scope: "global",
    category: "profile",
    type: "flag",
    defaults: EVERYONE,
    legacy: "can_view_profiles",
  },
  /** Show a signature under one's posts. */
  "profile.signature": {
    scope: "global",
    category: "profile",
    type: "flag",
    defaults: STAFF,
    requiresAccount: true,
  },
  /** Show a title of one's own under the name instead of the group or level title. */
  "profile.customTitle": {
    scope: "global",
    category: "profile",
    type: "flag",
    defaults: STAFF,
    requiresAccount: true,
  },
  /** Delete one's own account from the account pages (the same erasure an administrator can run). */
  "profile.deleteAccount": {
    scope: "global",
    category: "profile",
    type: "flag",
    defaults: MEMBERS,
    requiresAccount: true,
  },
  /** Choose a profile cover from the gallery. */
  "profile.coverPreset": {
    scope: "global",
    category: "profile",
    type: "flag",
    defaults: STAFF,
    requiresAccount: true,
  },
  /** Change one's own username without spending a shop item. */
  "profile.renameFree": {
    scope: "global",
    category: "profile",
    type: "flag",
    defaults: STAFF,
    requiresAccount: true,
  },
  /** How many awards a member shows next to their name. */
  "profile.awardSlots": {
    scope: "global",
    category: "profile",
    type: "integer",
    unit: "count",
    defaults: { unconfirmed: 5, registered: 5, moderator: 6, admin: 6 },
  },
  "profile.editOwn": {
    scope: "global",
    category: "profile",
    type: "flag",
    defaults: MEMBERS,
    requiresAccount: true,
  },
  "search.use": { scope: "global", category: "general", type: "flag", defaults: EVERYONE },
  "reaction.react": {
    scope: "global",
    category: "general",
    type: "flag",
    defaults: POSTERS,
    requiresAccount: true,
    legacy: "can_react",
  },
  "report.create": {
    scope: "global",
    category: "general",
    type: "flag",
    defaults: MEMBERS,
    requiresAccount: true,
  },
  /** Mentions that link and notify per item (-1 unlimited); new members also have a site limit. */
  "mention.maxPerItem": {
    scope: "global",
    category: "general",
    type: "integer",
    unit: "count",
    defaults: { unconfirmed: 10, registered: 10, moderator: -1, admin: -1 },
  },
  /** Put tags on a thread (its author, and staff on any thread); only tags that already exist. */
  "tag.apply": {
    scope: "global",
    category: "general",
    type: "flag",
    defaults: POSTERS,
    requiresAccount: true,
    restriction: "posting",
  },
  /** Make a tag nobody used before: by listing it on a thread or typing a new #hashtag in an opening post. */
  "tag.create": {
    scope: "global",
    category: "general",
    type: "flag",
    defaults: POSTERS,
    requiresAccount: true,
    restriction: "posting",
  },
  /** Rename, merge and delete tags (the tags screen of the staff panel). */
  "tag.manage": {
    scope: "global",
    category: "moderation",
    type: "flag",
    defaults: STAFF,
    requiresAccount: true,
  },
  // Anti-spam. The daily limits count what the member made in the last 24 hours, whatever became
  // of it afterwards (-1 or 0: no limit; to stop a group writing, take its posting permission). The bypasses are for members whose writes the
  // site's flood interval, word filter or spam check should not hold back.
  "antispam.postsPerDay": {
    scope: "global",
    category: "general",
    type: "integer",
    unit: "count",
    defaults: MEMBERS_UNLIMITED,
  },
  "antispam.threadsPerDay": {
    scope: "global",
    category: "general",
    type: "integer",
    unit: "count",
    defaults: MEMBERS_UNLIMITED,
  },
  "antispam.conversationsPerDay": {
    scope: "global",
    category: "general",
    type: "integer",
    unit: "count",
    defaults: MEMBERS_UNLIMITED,
  },
  "antispam.negativeReactionsPerDay": {
    scope: "global",
    category: "general",
    type: "integer",
    unit: "count",
    defaults: MEMBERS_UNLIMITED,
  },
  /**
   * Pictures and media from other sites in the member's text are shown as links. A restriction,
   * not a grant, so that a group made before it existed keeps embedding; administrators never
   * hold it.
   */
  "antispam.externalMediaAsLinks": {
    scope: "global",
    category: "general",
    type: "flag",
    defaults: { admin: "never" },
    requiresAccount: true,
  },
  /** Write again sooner than the site's flood interval allows. */
  "antispam.bypassFlood": {
    scope: "global",
    category: "moderation",
    type: "flag",
    defaults: STAFF,
    requiresAccount: true,
  },
  /** Post without the word filter replacing or holding back the text. */
  "antispam.bypassWordFilter": {
    scope: "global",
    category: "moderation",
    type: "flag",
    defaults: ADMINS,
    requiresAccount: true,
  },
  /** Post without the external spam check (StopForumSpam, Akismet) judging the text. */
  "antispam.bypassSpamCheck": {
    scope: "global",
    category: "moderation",
    type: "flag",
    defaults: ADMINS,
    requiresAccount: true,
  },
  "member.follow": {
    scope: "global",
    category: "general",
    type: "flag",
    defaults: MEMBERS,
    requiresAccount: true,
  },
  "member.ignore": {
    scope: "global",
    category: "general",
    type: "flag",
    defaults: MEMBERS,
    requiresAccount: true,
  },
  /** Held by the member others want to ignore: staff cannot be ignored by default. */
  "member.ignorable": {
    scope: "global",
    category: "general",
    type: "flag",
    defaults: { unconfirmed: "allow", registered: "allow", moderator: "never", admin: "never" },
  },
  "notification.view": {
    scope: "global",
    category: "general",
    type: "flag",
    defaults: MEMBERS,
    requiresAccount: true,
  },
  "attachment.storageQuota": {
    scope: "global",
    category: "general",
    type: "integer",
    unit: "bytes",
    defaults: {
      guest: 0,
      unconfirmed: 0,
      registered: 100 * 1024 * 1024,
      moderator: 1024 * 1024 * 1024,
      admin: 1024 * 1024 * 1024,
    },
  },

  /** Open the site: forums, threads, feeds, search, profiles and the member list. */
  "site.view": { scope: "global", category: "general", type: "flag", defaults: EVERYONE },
  /** Open the member list. */
  "member.viewList": { scope: "global", category: "general", type: "flag", defaults: EVERYONE },
  /** Upload an avatar. */
  "profile.uploadAvatar": {
    scope: "global",
    category: "profile",
    type: "flag",
    defaults: MEMBERS,
    requiresAccount: true,
  },
  /** Upload a profile cover. */
  "profile.uploadCover": {
    scope: "global",
    category: "profile",
    type: "flag",
    defaults: MEMBERS,
    requiresAccount: true,
  },
  /** Bookmark content (taking a bookmark off needs nothing). */
  "bookmark.create": {
    scope: "global",
    category: "general",
    type: "flag",
    defaults: MEMBERS,
    requiresAccount: true,
  },
  /**
   * Own username changes are refused with a message to ask staff, who can rename the member.
   * Not a queue: nothing is recorded for staff to approve. No built-in group holds it
   * (administrators are set to Never so that nothing locks them out).
   */
  "profile.renameNeedsApproval": {
    scope: "global",
    category: "profile",
    type: "flag",
    defaults: { admin: "never" },
    requiresAccount: true,
  },
  /**
   * Most username changes a member may make within `profile.renameWindowDays` (-1 unlimited, 0
   * none). Every change counts, free or bought.
   */
  "profile.renameLimit": {
    scope: "global",
    category: "profile",
    type: "integer",
    unit: "count",
    defaults: MEMBERS_UNLIMITED,
  },
  /**
   * The days `profile.renameLimit` counts back over; -1 counts every change ever made. 0 is the
   * same as unset: it counts every change when no group of the member sets days, and any group
   * that does set days overrides it. When groups differ the longest window applies.
   */
  "profile.renameWindowDays": {
    scope: "global",
    category: "profile",
    type: "integer",
    unit: "count",
    defaults: MEMBERS_UNLIMITED,
  },
  /**
   * Edit content without leaving the "edited" note (posts, wall posts, comments and messages).
   * The earlier text is still kept where revisions are kept.
   */
  "content.editSilently": {
    scope: "global",
    category: "general",
    type: "flag",
    defaults: ADMINS,
    requiresAccount: true,
  },
  /** Open the list of who reacted to an item. */
  "reaction.viewList": { scope: "global", category: "general", type: "flag", defaults: EVERYONE },
  /** Open the list of members another member follows (one's own is always open). */
  "member.viewFollowing": {
    scope: "global",
    category: "profile",
    type: "flag",
    defaults: EVERYONE,
  },
  /**
   * The largest single file the member may upload, in bytes (-1: only the site's own limit
   * applies; 0: no file). It can only lower the site's limit, never raise it. Covers attachments,
   * avatars and covers.
   */
  "attachment.maxFileSize": {
    scope: "global",
    category: "general",
    type: "integer",
    unit: "bytes",
    defaults: MEMBERS_UNLIMITED,
  },

  // Forums (node scope) -----------------------------------------------------------------
  "node.view": {
    scope: "node",
    category: "forum",
    type: "flag",
    defaults: EVERYONE,
    legacy: "can_view_nodes",
  },
  "forum.createThread": {
    scope: "node",
    category: "forum",
    type: "flag",
    defaults: POSTERS,
    requiresAccount: true,
    restriction: "posting",
    legacy: "can_post",
  },
  "forum.reply": {
    scope: "node",
    category: "forum",
    type: "flag",
    defaults: POSTERS,
    requiresAccount: true,
    restriction: "posting",
    threadBan: true,
    legacy: "can_post",
  },
  "forum.editOwn": {
    scope: "node",
    category: "forum",
    type: "flag",
    defaults: MEMBERS,
    requiresAccount: true,
    own: true,
    timeLimit: "forum.editOwnTimeLimit",
  },
  "forum.editOwnTimeLimit": {
    scope: "node",
    category: "forum",
    type: "integer",
    unit: "minutes",
    defaults: MEMBERS_UNLIMITED,
  },
  /** Read the edit history of one's own posts. */
  "forum.viewOwnHistory": {
    scope: "node",
    category: "forum",
    type: "flag",
    defaults: MEMBERS,
    requiresAccount: true,
    own: true,
  },
  "forum.editOwnThreadTitle": {
    scope: "node",
    category: "forum",
    type: "flag",
    defaults: MEMBERS,
    requiresAccount: true,
    own: true,
  },
  /** Hide one's own posts (soft delete: staff can restore them). The opening post goes with its thread. */
  "forum.deleteOwn": {
    scope: "node",
    category: "forum",
    type: "flag",
    defaults: MEMBERS,
    requiresAccount: true,
    own: true,
  },
  /** Hide one's own thread (soft delete: staff can restore it). */
  "forum.deleteOwnThread": {
    scope: "node",
    category: "forum",
    type: "flag",
    defaults: ADMINS,
    requiresAccount: true,
    own: true,
  },
  /**
   * Delete one's own posts and threads for good, in one step. Staff keep whatever they hid: it
   * reaches only content the author can still open.
   */
  "forum.hardDeleteOwn": {
    scope: "node",
    category: "forum",
    type: "flag",
    defaults: ADMINS,
    requiresAccount: true,
    own: true,
  },
  /** Lock one's own thread, and unlock it again when the author locked it. */
  "forum.lockOwn": {
    scope: "node",
    category: "forum",
    type: "flag",
    defaults: ADMINS,
    requiresAccount: true,
    own: true,
  },
  /** React to posts in the forum (as well as `reaction.react`). */
  "forum.react": {
    scope: "node",
    category: "forum",
    type: "flag",
    defaults: POSTERS,
    requiresAccount: true,
  },
  /**
   * Open threads other members started. Without it a member sees only their own threads in the
   * forum: lists, search, feeds, alerts and the public pages leave the others out.
   */
  "forum.viewOthers": {
    scope: "node",
    category: "forum",
    type: "flag",
    defaults: EVERYONE,
    defaultAllow: true,
  },
  /**
   * Read the posts of a thread. Without it only titles are listed, and the text of the opening
   * post, the posts, search results, feeds and public pages are closed; what a member wrote
   * themselves stays readable to them.
   */
  "forum.viewContent": {
    scope: "node",
    category: "forum",
    type: "flag",
    defaults: EVERYONE,
    defaultAllow: true,
  },
  "forum.viewAttachments": {
    scope: "node",
    category: "forum",
    type: "flag",
    defaults: EVERYONE,
  },
  "forum.uploadAttachments": {
    scope: "node",
    category: "forum",
    type: "flag",
    defaults: MEMBERS,
    requiresAccount: true,
  },
  "forum.viewModerated": nodeModerator(),
  "forum.viewDeleted": nodeModerator(),
  "forum.editAny": nodeModerator(),
  "forum.deleteAny": nodeModerator(),
  /**
   * Delete a thread or post for good, once it is soft-deleted. Administrators by default; grant
   * it to moderators per forum.
   */
  "forum.hardDelete": {
    scope: "node",
    category: "forum",
    type: "flag",
    defaults: ADMINS,
    requiresAccount: true,
  },
  "forum.undelete": nodeModerator(),
  "forum.approve": nodeModerator(),
  "forum.viewHistory": nodeModerator(),
  "forum.lock": nodeModerator(),
  "forum.replyLocked": nodeModerator(),
  "forum.stick": nodeModerator(),
  /** Feature a thread as a staff pick (Hot and the home page), or end the pick. */
  "forum.feature": nodeModerator(),
  "forum.move": nodeModerator(),
  "forum.manageReports": nodeModerator(),
  "forum.merge": nodeModerator(),
  "forum.split": nodeModerator(),
  "forum.threadBan": { ...nodeModerator(), hierarchy: true },
  /** Post despite the node's read-only, approval, account-age and post-count settings. */
  "forum.bypassNodeRules": nodeModerator(),
  /** See the moderator log for this node. */
  "forum.viewLog": nodeModerator(),
  /** Warn a member about one of their posts in this forum (`warnings.create` with a `postId`). */
  "forum.warn": { ...nodeModerator(), hierarchy: true },

  // Profile posts -----------------------------------------------------------------------
  "profilePost.post": {
    scope: "global",
    category: "profile",
    type: "flag",
    defaults: POSTERS,
    requiresAccount: true,
    restriction: "profile_posts",
    legacy: "can_post_profile",
  },
  "profilePost.comment": {
    scope: "global",
    category: "profile",
    type: "flag",
    defaults: POSTERS,
    requiresAccount: true,
    restriction: "profile_posts",
    legacy: "can_post_profile",
  },

  /** Post on one's own profile; `profilePost.post` is posting on other members' profiles. */
  "profilePost.postOwn": {
    scope: "global",
    category: "profile",
    type: "flag",
    defaults: POSTERS,
    requiresAccount: true,
    restriction: "profile_posts",
  },
  /** React to wall posts and their comments (as well as `reaction.react`). */
  "profilePost.react": {
    scope: "global",
    category: "profile",
    type: "flag",
    defaults: POSTERS,
    requiresAccount: true,
  },
  /** Read wall posts and their comments. */
  "profilePost.view": { scope: "global", category: "profile", type: "flag", defaults: EVERYONE },
  "profilePost.editOwn": {
    scope: "global",
    category: "profile",
    type: "flag",
    defaults: MEMBERS,
    requiresAccount: true,
    own: true,
  },
  "profilePost.deleteOwn": {
    scope: "global",
    category: "profile",
    type: "flag",
    defaults: MEMBERS,
    requiresAccount: true,
    own: true,
  },
  /** Delete posts on your own wall (and comments under them); `ownerId` is the wall owner. */
  "profilePost.manageOwnWall": {
    scope: "global",
    category: "profile",
    type: "flag",
    defaults: MEMBERS,
    requiresAccount: true,
    own: true,
  },
  "profilePost.viewModerated": globalModerator("profile"),
  "profilePost.viewDeleted": globalModerator("profile"),
  "profilePost.editAny": globalModerator("profile"),
  "profilePost.deleteAny": globalModerator("profile"),
  /** Delete a soft-deleted profile post, with its comments, for good. */
  "profilePost.hardDelete": {
    scope: "global",
    category: "profile",
    type: "flag",
    defaults: ADMINS,
    requiresAccount: true,
  },
  "profilePost.undelete": globalModerator("profile"),
  "profilePost.approve": globalModerator("profile"),

  // Conversations -----------------------------------------------------------------------
  "conversation.start": {
    scope: "global",
    category: "conversation",
    type: "flag",
    defaults: POSTERS,
    requiresAccount: true,
    restriction: "conversations",
    legacy: "can_start_conversations",
  },
  "conversation.reply": {
    scope: "global",
    category: "conversation",
    type: "flag",
    defaults: MEMBERS,
    requiresAccount: true,
  },
  "conversation.maxRecipients": {
    scope: "global",
    category: "conversation",
    type: "integer",
    unit: "count",
    defaults: MEMBERS_UNLIMITED,
  },

  /** Be added to conversations. */
  "conversation.receive": {
    scope: "global",
    category: "conversation",
    type: "flag",
    defaults: MEMBERS,
    requiresAccount: true,
  },
  /** Attach files to conversation messages. */
  "conversation.attach": {
    scope: "global",
    category: "conversation",
    type: "flag",
    defaults: MEMBERS,
    requiresAccount: true,
  },
  /** React to conversation messages (as well as `reaction.react`). */
  "conversation.react": {
    scope: "global",
    category: "conversation",
    type: "flag",
    defaults: POSTERS,
    requiresAccount: true,
  },
  /**
   * Start a conversation with, or add, members who have ignored the holder. The recipient's
   * ignore list is the only privacy setting conversations have.
   */
  "conversation.alwaysInvite": {
    scope: "global",
    category: "conversation",
    type: "flag",
    defaults: STAFF,
    requiresAccount: true,
  },
  /** Minutes after sending within which one's own messages can be edited (-1 unlimited). */
  "conversation.editOwnTimeLimit": {
    scope: "global",
    category: "conversation",
    type: "integer",
    unit: "minutes",
    defaults: MEMBERS_UNLIMITED,
  },
  /** Edit your own messages in conversations you take part in. */
  "conversation.editOwn": {
    scope: "global",
    category: "conversation",
    type: "flag",
    defaults: MEMBERS,
    requiresAccount: true,
    own: true,
    timeLimit: "conversation.editOwnTimeLimit",
  },
  /** Delete your own messages (not the first one) in conversations you take part in. */
  "conversation.deleteOwn": {
    scope: "global",
    category: "conversation",
    type: "flag",
    defaults: MEMBERS,
    requiresAccount: true,
    own: true,
  },
  /** See deleted and unapproved messages in conversations you take part in. */
  "conversation.viewHidden": globalAdmin("conversation"),
  /** Moderate messages and handle reports on them. */
  "conversation.moderate": globalAdmin("conversation"),

  // Moderation (global) -----------------------------------------------------------------
  /** Marks the member as a moderator (`auth.me` isModerator); queue items are checked one by one. */
  "moderation.access": globalModerator("moderation"),
  /** Handle reports on profile content and on members. */
  "report.manageProfiles": globalModerator("moderation"),
  "warning.view": globalModerator("moderation"),
  "member.restrict": { ...globalModerator("moderation"), hierarchy: true },
  /** See and post on profiles regardless of their owners' privacy settings. */
  "profile.bypassPrivacy": globalModerator("profile"),
  "member.warn": { ...globalModerator("moderation"), hierarchy: true },
  /** Delete a warning, or end it early (it stops counting, the record stays). */
  "warning.delete": { ...globalModerator("moderation"), hierarchy: true },
  /** Most points one warning may carry, a type's or a custom value (-1 unlimited, 0 none; 10 when unset). */
  "warning.maxPoints": {
    scope: "global",
    category: "moderation",
    type: "integer",
    unit: "count",
    defaults: { moderator: 10, admin: -1 },
    unset: 10,
  },
  /** Most warnings one moderator may give in 24 hours (-1 unlimited, 0 none; 20 when unset). */
  "warning.perDay": {
    scope: "global",
    category: "moderation",
    type: "integer",
    unit: "count",
    defaults: { moderator: 20, admin: -1 },
    unset: 20,
  },
  /**
   * Edit the basic profile of a member who ranks below: about, location, website, birthday, links,
   * title, signature and removing pictures. What a member wears stays with `admin.members`.
   */
  "member.editProfile": { ...globalModerator("moderation"), hierarchy: true },
  "member.ban": { ...globalModerator("moderation"), hierarchy: true },
  /**
   * Longest ban the holder may give, in days (-1 permanent, 0 none). Banning needs `member.ban`
   * as well; moderators hold both, bounded to 30 days.
   */
  "member.banMaxDays": {
    scope: "global",
    category: "moderation",
    type: "integer",
    unit: "count",
    defaults: { moderator: 30, admin: -1 },
    unset: 30,
  },
  "member.spamCleanup": { ...globalAdmin("moderation"), hierarchy: true },
  /** Approve or reject the new accounts that wait in the sign-up queue. */
  "member.approveRegistrations": {
    scope: "global",
    category: "moderation",
    type: "flag",
    defaults: STAFF,
    requiresAccount: true,
    hierarchy: true,
  },
  /** Held by the warned member: reaching the warning threshold does not ban them. */
  "member.immuneToAutoBan": globalAdmin("moderation"),
  "wordFilter.view": globalModerator("moderation"),
  "wordFilter.manage": globalAdmin("moderation"),
  "moderatorLog.view": globalAdmin("moderation"),
  /** See the addresses members signed in, registered and posted from, and who shares them. */
  "member.viewIps": { ...globalAdmin("moderation"), hierarchy: true },

  // Economy (global) --------------------------------------------------------------------
  /** Give or take credits by hand, with a reason. */
  "credits.adjust": globalAdmin("economy"),
  /** See any member's credit ledger (members always see their own). */
  "credits.viewAny": globalModerator("economy"),
  /** Grant awards to members by hand, and revoke grants. */
  "award.grant": globalModerator("economy"),
  "shop.buy": {
    scope: "global",
    category: "economy",
    type: "flag",
    defaults: POSTERS,
    requiresAccount: true,
  },
  /** Buy a giftable item for another member; needs shop.buy as well. */
  "shop.gift": {
    scope: "global",
    category: "economy",
    type: "flag",
    defaults: POSTERS,
    requiresAccount: true,
  },

  // Administration ----------------------------------------------------------------------
  "admin.nodes": globalAdmin("admin"),
  /** Manage thread prefixes (the labels members put on threads). */
  "admin.prefixes": globalAdmin("admin"),
  /** Manage the navigation entries of the header, footer and menus. */
  "admin.navigation": globalAdmin("admin"),
  /** Manage static pages (terms, rules, about). */
  "admin.pages": globalAdmin("admin"),
  "admin.groups": globalAdmin("admin"),
  "admin.members": { ...globalAdmin("admin"), hierarchy: true },
  "admin.permissions": globalAdmin("admin"),
  "admin.promotions": globalAdmin("admin"),
  "admin.announcements": globalAdmin("admin"),
  "admin.settings": globalAdmin("admin"),
  "admin.reactionTypes": globalAdmin("admin"),
  "admin.creditRules": globalAdmin("admin"),
  "admin.awards": globalAdmin("admin"),
  /** Manage shop categories and items, and see the purchase log and any inventory. */
  "admin.shop": globalAdmin("admin"),
  /** Manage the picture and colour catalogs members choose their appearance from. */
  "admin.appearance": globalAdmin("admin"),
} as const satisfies Record<string, PermissionDefinition>;

function globalModerator(category: BaseDefinition["category"]): FlagDefinition {
  return {
    scope: "global",
    category,
    type: "flag",
    defaults: STAFF,
    requiresAccount: true,
    legacy: "is_moderator",
  };
}

function globalAdmin(category: BaseDefinition["category"]): FlagDefinition {
  return {
    scope: "global",
    category,
    type: "flag",
    defaults: ADMINS,
    requiresAccount: true,
    legacy: "is_admin",
  };
}

export type PermissionId = keyof typeof PERMISSIONS;
export type FlagPermissionId = {
  [K in PermissionId]: (typeof PERMISSIONS)[K]["type"] extends "flag" ? K : never;
}[PermissionId];
export type IntegerPermissionId = Exclude<PermissionId, FlagPermissionId>;

export const PERMISSION_IDS = Object.keys(PERMISSIONS) as PermissionId[];

export function permissionDefinition(id: PermissionId): PermissionDefinition {
  return PERMISSIONS[id];
}

/** Phrase keys for the label and description shown in the admin UI. */
export function permissionPhrases(id: PermissionId): { label: string; description: string } {
  return { label: `permission.${id}`, description: `permission.${id}.description` };
}

/** Value of an integer permission that means "no limit". */
export const UNLIMITED_VALUE = -1;
