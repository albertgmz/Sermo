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
  readonly category: "general" | "forum" | "profile" | "conversation" | "moderation" | "admin";
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
}

export interface IntegerDefinition extends BaseDefinition {
  readonly type: "integer";
  /** -1 means unlimited. */
  readonly defaults: Partial<Record<BuiltinGroup, number>>;
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
  "forum.editOwnThreadTitle": {
    scope: "node",
    category: "forum",
    type: "flag",
    defaults: MEMBERS,
    requiresAccount: true,
    own: true,
  },
  "forum.deleteOwn": {
    scope: "node",
    category: "forum",
    type: "flag",
    defaults: MEMBERS,
    requiresAccount: true,
    own: true,
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
  "forum.undelete": nodeModerator(),
  "forum.approve": nodeModerator(),
  "forum.viewHistory": nodeModerator(),
  "forum.lock": nodeModerator(),
  "forum.replyLocked": nodeModerator(),
  "forum.stick": nodeModerator(),
  "forum.move": nodeModerator(),
  "forum.manageReports": nodeModerator(),

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
  /** See deleted and unapproved messages in conversations you take part in. */
  "conversation.viewHidden": globalAdmin("conversation"),
  /** Moderate messages and handle reports on them. */
  "conversation.moderate": globalAdmin("conversation"),

  // Moderation (global) -----------------------------------------------------------------
  /** Open the report and approval queues (each item is still checked). */
  "moderation.access": globalModerator("moderation"),
  /** Handle reports on profile content and on members. */
  "report.manageProfiles": globalModerator("moderation"),
  "warning.view": globalModerator("moderation"),
  "member.warn": { ...globalModerator("moderation"), hierarchy: true },
  "member.ban": { ...globalAdmin("moderation"), hierarchy: true },
  "member.spamCleanup": { ...globalAdmin("moderation"), hierarchy: true },
  /** Held by the warned member: reaching the warning threshold does not ban them. */
  "member.immuneToAutoBan": globalAdmin("moderation"),
  "wordFilter.view": globalModerator("moderation"),
  "wordFilter.manage": globalAdmin("moderation"),
  "moderatorLog.view": globalAdmin("moderation"),

  // Administration ----------------------------------------------------------------------
  "admin.nodes": globalAdmin("admin"),
  "admin.groups": globalAdmin("admin"),
  "admin.members": { ...globalAdmin("admin"), hierarchy: true },
  "admin.permissions": globalAdmin("admin"),
  "admin.settings": globalAdmin("admin"),
  "admin.reactionTypes": globalAdmin("admin"),
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
