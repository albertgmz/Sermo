import * as z from "zod";
import { defineContract } from "../operation";
import { Empty, Id, Ok, Page, pageInput, Timestamp, UserSummary } from "./common";
import { MemberCard } from "./members";

/*
 * What the administration panel needs beyond the operations each feature already has: who the
 * staff are, what happened lately, and editing another member. Every write here that touches a
 * member is refused unless the member ranks below the actor (the hierarchy), is written to the
 * moderator log, and never deletes content.
 */

// The panel's home ---------------------------------------------------------------------------

export const ACTIVITY_KINDS = [
  "moderation",
  "reports",
  "creditAdjustments",
  "shopPurchases",
  "promotions",
  "registrations",
] as const;

export const adminActivity = defineContract({
  name: "admin.activity",
  summary:
    "How much was logged in the last day, week and thirty days, per kind: moderator log " +
    "entries, reports filed, manual credit adjustments, shop purchases, promotions applied and " +
    "registrations. Each kind is returned only to an actor who may read its log " +
    "(moderatorLog.view, the report queue, credits.viewAny, admin.shop, admin.promotions, " +
    "admin.members); an actor who may read none gets a not-found.",
  kind: "read",
  input: Empty,
  output: z.object({
    items: z.array(
      z.object({
        kind: z.enum(ACTIVITY_KINDS),
        day: z.number().int().nonnegative(),
        week: z.number().int().nonnegative(),
        month: z.number().int().nonnegative(),
      }),
    ),
  }),
});

export const adminStaffOnline = defineContract({
  name: "admin.staffOnline",
  summary:
    "The staff members (members of a group marked as staff) seen in the last fifteen minutes, " +
    "most recent first, at most 50. For anyone who may open any part of the panel (see " +
    "auth.me `staff`, where a permission that only exempts a member, such as " +
    "member.immuneToAutoBan, does not make staff); others get a not-found.",
  kind: "read",
  input: Empty,
  output: z.object({
    items: z.array(z.object({ card: MemberCard, lastActivityAt: Timestamp })),
  }),
});

export const adminJobs = defineContract({
  name: "admin.jobs",
  summary:
    "The state of background work: how many jobs are pending, running and failed, the oldest " +
    "pending job's age, and the 20 most recent failures with their type and error. Requires " +
    "admin.settings.",
  kind: "read",
  input: Empty,
  output: z.object({
    pending: z.number().int().nonnegative(),
    running: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    oldestPendingAt: Timestamp.nullable(),
    failures: z.array(
      z.object({ id: Id, type: z.string(), error: z.string(), failedAt: Timestamp }),
    ),
  }),
});

// Staff rosters ------------------------------------------------------------------------------

export const staffModerators = defineContract({
  name: "staff.moderators",
  summary:
    "Who moderates what: every member holding a moderation permission, with the forums it " +
    "applies to (`everywhere` when held globally, else the forums where it is granted to them or " +
    "to one of their groups), at most 200, by username. Requires admin.permissions.",
  kind: "read",
  input: Empty,
  output: z.object({
    items: z.array(
      z.object({
        card: MemberCard,
        everywhere: z.boolean(),
        nodes: z.array(z.object({ id: Id, title: z.string() })),
      }),
    ),
  }),
});

export const staffAdministrators = defineContract({
  name: "staff.administrators",
  summary:
    "Every member holding at least one administration permission (category `admin`), with the " +
    "ids of the ones they hold, at most 200, by username. Requires admin.permissions.",
  kind: "read",
  input: Empty,
  output: z.object({
    items: z.array(z.object({ card: MemberCard, permissions: z.array(z.string()) })),
  }),
});

// Members ------------------------------------------------------------------------------------

export const ACCOUNT_STATES = ["valid", "unconfirmed", "banned"] as const;

export const AdminMember = z
  .object({
    card: MemberCard,
    email: z.string(),
    emailVerified: z.boolean(),
    /** `banned` while a ban is in force; `unconfirmed` while in the unconfirmed group. */
    state: z.enum(ACCOUNT_STATES),
    createdAt: Timestamp,
    lastActivityAt: Timestamp.nullable(),
    /** When the username last changed; null if never. */
    usernameChangedAt: Timestamp.nullable(),
    postCount: z.number().int().nonnegative(),
    credits: z.number().int(),
    /** Whether the actor outranks this member and may therefore edit them. */
    canEdit: z.boolean(),
  })
  .meta({ id: "AdminMember" });

export const usersAdminList = defineContract({
  name: "users.adminList",
  summary:
    "Every member for administration, newest first, optionally only those in one account state " +
    "or one group (primary or secondary by hand), or whose username or email starts with " +
    "`prefix`. Requires admin.members.",
  kind: "read",
  input: z.object({
    state: z.enum(ACCOUNT_STATES).optional(),
    groupId: Id.optional(),
    prefix: z.string().trim().min(1).max(64).optional(),
    ...pageInput,
  }),
  output: Page(AdminMember),
});

export const usersAdminGet = defineContract({
  name: "users.adminGet",
  summary: "One member for administration. Requires admin.members.",
  kind: "read",
  input: z.object({ userId: Id }),
  output: AdminMember,
});

/** The acting administrator's own password, checked before a sensitive change is made. */
const ActorPassword = z.string().min(1).max(256);

export const authVerifyPassword = defineContract({
  name: "auth.verifyPassword",
  summary:
    "Check the signed-in member's own password without changing anything; a wrong password is " +
    "refused. For clients that ask for the password again before a sensitive change. Session " +
    "actors only (not API keys).",
  kind: "write",
  input: z.object({ password: ActorPassword }),
  output: Ok,
});

export const usersAdminUpdateIdentity = defineContract({
  name: "users.adminUpdateIdentity",
  summary:
    "Change another member's username, email or password, through the identity provider. The " +
    "actor's own password is required and checked first. `username` obeys the registration " +
    "rules and must be free. `email` is stored as given and marked verified or not by " +
    "`emailVerified` (default: unchanged). `password` sets a new one and signs the member out " +
    "everywhere; `sendPasswordReset` instead emails them a reset link (a conflict when mail is " +
    "not configured). Requires admin.members over the member; session actors only.",
  kind: "write",
  input: z.object({
    userId: Id,
    actorPassword: ActorPassword,
    username: z.string().trim().min(1).max(64).optional(),
    email: z.email().max(254).optional(),
    emailVerified: z.boolean().optional(),
    password: z.string().min(8).max(256).optional(),
    sendPasswordReset: z.boolean().optional(),
  }),
  output: AdminMember,
});

export const usersAdminUpdateProfile = defineContract({
  name: "users.adminUpdateProfile",
  summary:
    "Edit another member's profile: the fields of profiles.update (a title and a signature can " +
    "be set whether or not the member holds the permission to show them), what they wear " +
    "(any active catalog entry, held or not; null takes it off), and `removeAvatar` / " +
    "`removeCover` to delete their uploaded pictures. Only the keys sent change. Requires " +
    "admin.members over the member.",
  kind: "write",
  input: z.object({
    userId: Id,
    about: z.string().trim().max(5000).optional(),
    location: z.string().trim().max(100).optional(),
    website: z.string().trim().max(200).optional(),
    customTitle: z.string().trim().max(100).nullable().optional(),
    signature: z.string().trim().max(2000).nullable().optional(),
    accentId: Id.nullable().optional(),
    nameColorId: Id.nullable().optional(),
    frameId: Id.nullable().optional(),
    coverPresetId: Id.nullable().optional(),
    removeAvatar: z.boolean().optional(),
    removeCover: z.boolean().optional(),
    reason: z.string().trim().max(1000).default(""),
  }),
  output: AdminMember,
});

export const AdminSession = z
  .object({
    id: Id,
    createdAt: Timestamp,
    expiresAt: Timestamp,
    ipAddress: z.string().nullable(),
    userAgent: z.string().nullable(),
  })
  .meta({ id: "AdminSession" });

export const usersAdminSessions = defineContract({
  name: "users.adminSessions",
  summary:
    "A member's active sessions, newest first (at most 100): when each was created and " +
    "expires, its address and user agent. Never its token. Requires admin.members over the " +
    "member.",
  kind: "read",
  input: z.object({ userId: Id }),
  output: z.object({ items: z.array(AdminSession) }),
});

export const usersAdminRevokeSessions = defineContract({
  name: "users.adminRevokeSessions",
  summary:
    "Sign a member out: one session by id, or all of them when `sessionId` is omitted. Their " +
    "API keys are not touched. Requires admin.members over the member.",
  kind: "write",
  input: z.object({
    userId: Id,
    sessionId: Id.optional(),
    reason: z.string().trim().max(1000).default(""),
  }),
  output: z.object({ revoked: z.number().int().nonnegative() }),
});

export const usersAdminLog = defineContract({
  name: "users.adminLog",
  summary:
    "The moderator log entries about one member, newest first: administrative edits, group " +
    "changes, warnings, bans, restrictions and session revocations. Requires admin.members.",
  kind: "read",
  input: z.object({ userId: Id, ...pageInput }),
  output: Page(
    z.object({
      id: Id,
      actor: UserSummary,
      action: z.string(),
      reason: z.string(),
      details: z.record(z.string(), z.unknown()),
      createdAt: Timestamp,
    }),
  ),
});

export const usersAdminErase = defineContract({
  name: "users.adminErase",
  summary:
    "Close a member's account for good and remove what identifies them. In one go: every " +
    "session and API key is revoked; the member is banned permanently; their email is replaced " +
    "by a unique placeholder and their password removed, so nobody can sign in or recover the " +
    "account; their username becomes `Deleted member <id>`; their about text, title, " +
    "signature, location, website, birthday, social handles, avatar and cover are removed and " +
    "what they wear is taken off; their follows in both directions end. What they wrote " +
    "(threads, posts, wall posts, messages) stays as it is under the new name, and their " +
    "ledger, warnings and log entries are kept. It cannot be undone. The actor's own password " +
    "is required. Requires admin.members over the member, and is refused for the last member " +
    "holding admin.permissions; session actors only.",
  kind: "write",
  input: z.object({
    userId: Id,
    actorPassword: ActorPassword,
    reason: z.string().trim().min(1).max(1000),
  }),
  output: Ok,
});

// Sanctions ----------------------------------------------------------------------------------

export const BAN_STATES = ["active", "expired", "lifted"] as const;

export const bansList = defineContract({
  name: "bans.list",
  summary:
    "The ban register, newest first: every ban with who gave it, why, when it ends and whether " +
    "it was lifted. `state` narrows it to bans in force, bans that ran out, or bans lifted by " +
    "hand; `userId` to one member. Requires member.ban.",
  kind: "read",
  input: z.object({
    state: z.enum(BAN_STATES).optional(),
    userId: Id.optional(),
    ...pageInput,
  }),
  output: Page(
    z.object({
      id: Id,
      user: UserSummary,
      moderator: UserSummary,
      reason: z.string(),
      createdAt: Timestamp,
      /** Null for a permanent ban. */
      expiresAt: Timestamp.nullable(),
      liftedAt: Timestamp.nullable(),
      state: z.enum(BAN_STATES),
    }),
  ),
});

// Communication ------------------------------------------------------------------------------

export const announcementsList = defineContract({
  name: "announcements.list",
  summary: "The announcements sent so far, newest first. Requires admin.announcements.",
  kind: "read",
  input: z.object({ ...pageInput }),
  output: Page(
    z.object({
      id: Id,
      title: z.string(),
      bodyHtml: z.string(),
      author: UserSummary,
      createdAt: Timestamp,
    }),
  ),
});

// Moderation ---------------------------------------------------------------------------------

export const approvalsViewConversationMessage = defineContract({
  name: "approvals.viewConversationMessage",
  summary:
    "A conversation message that is waiting for approval, with up to 3 messages before and " +
    "after it, so a moderator can decide. Requires conversation.moderate and that the message " +
    "is in the approval queue. Every call is written to the moderator log (so it is a write); " +
    "nothing else lets a non-participant read a conversation.",
  kind: "write",
  input: z.object({ messageId: Id }),
  output: z.object({
    conversationId: Id,
    title: z.string(),
    messages: z.array(
      z.object({
        id: Id,
        author: UserSummary,
        bodyHtml: z.string(),
        createdAt: Timestamp,
        /** The message under review. */
        isTarget: z.boolean(),
      }),
    ),
  }),
});
