import * as z from "zod";
import { defineContract } from "../operation";
import { Empty, Id, Ok, Page, pageInput, Timestamp, UserSummary } from "./common";
import { MemberCard } from "./members";
import { AnnouncementAudience } from "./notifications";
import { BirthdayInput, Handle } from "./profiles";
import { Device } from "./security";

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
    "(moderatorLog.view, credits.viewAny, admin.shop, admin.promotions, admin.members; the " +
    "reports kind needs a report permission held globally: report.manageProfiles, " +
    "conversation.moderate or forum.manageReports through a global entry, since it counts " +
    "the whole site and not one forum). An actor who may read none gets a not-found. The counts are " +
    "exact; a result is kept for 60 seconds and shared by actors who may read the same kinds.",
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
    "pending job's age, and the 20 most recent failures with their type and error, the latest " +
    "failure first (`failedAt` is when the job was last marked failed). `oldestPendingAt` is " +
    "the oldest pending job that is already due: a job waiting for a later time (a retry after " +
    "a failure, work scheduled ahead) is ignored. Requires admin.settings.",
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
    "to one of their groups), at most 200, by username. `truncated` is true when more members " +
    "hold one than the 200 shown. Requires admin.permissions.",
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
    truncated: z.boolean(),
  }),
});

export const staffAdministrators = defineContract({
  name: "staff.administrators",
  summary:
    "Every member holding at least one administration permission (category `admin`), with the " +
    "ids of the ones they hold, at most 200, by username. `truncated` is true when more members " +
    "hold one than the 200 shown. Requires admin.permissions.",
  kind: "read",
  input: Empty,
  output: z.object({
    items: z.array(z.object({ card: MemberCard, permissions: z.array(z.string()) })),
    truncated: z.boolean(),
  }),
});

// Members ------------------------------------------------------------------------------------

export const ACCOUNT_STATES = ["valid", "unconfirmed", "banned", "erased"] as const;

export const AdminMember = z
  .object({
    card: MemberCard,
    /** Null for a member who ranks at or above the viewer (`canEdit` is false). */
    email: z.string().nullable(),
    emailVerified: z.boolean(),
    /**
     * `erased` once an administrator erased the account (it wins over the rest), `banned`
     * while a ban is in force, `unconfirmed` while in the unconfirmed group.
     */
    state: z.enum(ACCOUNT_STATES),
    /** When the account was erased; null if never. */
    erasedAt: Timestamp.nullable(),
    createdAt: Timestamp,
    lastActivityAt: Timestamp.nullable(),
    /** When the username last changed; null if never. */
    usernameChangedAt: Timestamp.nullable(),
    postCount: z.number().int().nonnegative(),
    credits: z.number().int(),
    /** Whether the actor outranks this member and may therefore edit them. */
    canEdit: z.boolean(),
    /** Whether the member is a super admin. */
    isSuperAdmin: z.boolean(),
    /** Whether the viewer is a super admin and the member's account is not erased. */
    canSetSuperAdmin: z.boolean(),
  })
  .meta({ id: "AdminMember" });

export const usersAdminList = defineContract({
  name: "users.adminList",
  summary:
    "Every member for administration, newest first, optionally only those in one account state " +
    "or one group (primary or secondary by hand), or whose username or email starts with " +
    "`prefix`. With `prefix` the order is by username (those whose username starts with it) and " +
    "then by email (those matched by email alone), not newest first. A page may be short, even " +
    "empty, when filters leave few of the rows examined; continue with `nextCursor` until it is " +
    "null. A member who ranks at or above the actor is listed with `email` null (`canEdit` " +
    "false) and is not found by an email prefix. Requires admin.members.",
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
  summary:
    "One member for administration; `email` is null for a member who ranks at or above the " +
    "actor. Requires admin.members.",
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
    "refused, and after five wrong answers in fifteen minutes from one session (twenty from all of " +
    "the member's sessions) every answer is refused until the window moves on (a right answer " +
    "does not clear the wrong ones). For clients that ask for " +
    "the password again before a sensitive change. Session actors only (not API keys).",
  kind: "write",
  input: z.object({ password: ActorPassword }),
  output: Ok,
});

export const usersAdminUpdateIdentity = defineContract({
  name: "users.adminUpdateIdentity",
  summary:
    "Change another member's username, email or password, through the identity provider. The " +
    "actor's own password is required and checked first. `username` obeys the registration " +
    'rules and must be free (a name that begins with "deleted member" is never free). ' +
    "`email` is stored in lower case and marked verified or not by " +
    "`emailVerified` (default: unchanged). `password` sets a new one, revokes their API keys and signs the member out " +
    "everywhere; `sendPasswordReset` instead emails them a reset link (a conflict when mail is " +
    "not configured). A new password or address also cancels the reset and change-email links " +
    "the member requested before. Five wrong answers of the actor's own password in fifteen " +
    "minutes from one session (twenty from all their sessions) block further attempts until " +
    "the window moves on. Requires admin.members over the " +
    "member, and also admin.permissions when the member holds any administration permission; " +
    "a conflict for an erased member; session actors only.",
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
    "Edit another member's profile: the fields of profiles.update, birthday and socials " +
    "included (a title and a signature can " +
    "be set whether or not the member holds the permission to show them), what they wear " +
    "(any active catalog entry, held or not; null takes it off), and `removeAvatar` / " +
    "`removeCover` to delete their uploaded pictures. Only the keys sent change. Requires " +
    "admin.members over the member, or member.editProfile over the member for everything but what " +
    "they wear (`accentId`, `nameColorId`, `frameId`, `coverPresetId`).",
  kind: "write",
  input: z.object({
    userId: Id,
    about: z.string().trim().max(5000).optional(),
    location: z.string().trim().max(100).optional(),
    website: z.string().trim().max(200).optional(),
    birthday: BirthdayInput.nullable().optional(),
    socials: z.object({ discord: Handle, telegram: Handle, x: Handle }).partial().optional(),
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
    device: Device,
  })
  .meta({ id: "AdminSession" });

export const usersAdminSessions = defineContract({
  name: "users.adminSessions",
  summary:
    "A member's active sessions, newest first (at most 100): when each was created and " +
    "expires, its address (normalised), user agent and the device parsed from it. Never its " +
    "token. Requires admin.members over the member.",
  kind: "read",
  input: z.object({ userId: Id }),
  output: z.object({ items: z.array(AdminSession) }),
});

export const usersAdminRevokeSessions = defineContract({
  name: "users.adminRevokeSessions",
  summary:
    "Sign a member out: one session by id, or all of them when `sessionId` is omitted. Signing " +
    "out all of them takes effect on the member's next request, even with the session cookie " +
    "cache on; one session by id also leaves the member's cached cookie valid until the cache " +
    "expires (at most five minutes). Signing out all of them also revokes the member's API keys. Requires admin.members " +
    "over the member, and also admin.permissions when the member holds any administration " +
    "permission; a conflict for an erased member.",
  kind: "write",
  input: z.object({
    userId: Id,
    sessionId: Id.optional(),
    reason: z.string().trim().max(1000).default(""),
  }),
  output: z.object({ revoked: z.number().int().nonnegative() }),
});

export const usersSetSuperAdmin = defineContract({
  name: "users.setSuperAdmin",
  summary:
    "Grant or remove the super admin flag. Only a super admin can, with their own password. A " +
    "super admin may act on any member, administrators and themselves included, while other " +
    "administrators cannot act on an administrator. The last super admin cannot be removed; " +
    "an erased member cannot be granted it.",
  kind: "write",
  input: z.object({ userId: Id, superAdmin: z.boolean(), actorPassword: ActorPassword }),
  output: Ok,
});

export const usersAdminLog = defineContract({
  name: "users.adminLog",
  summary:
    "The moderator log entries about one member, newest first: administrative edits, group " +
    "changes, warnings, bans, restrictions and session revocations. Requires admin.members " +
    "over the member: a member who ranks at or above the actor is not found (the actor's own log is).",
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
    "Close a member's account for good and remove what identifies them. The account is marked " +
    "erased and banned permanently first, in one step with its log entry (the ban cannot be " +
    "lifted afterwards); then every session and API key is revoked and every pending reset or " +
    "change-email link and queued account email is removed; their email is replaced " +
    "by a unique placeholder and their password removed, so nobody can sign in or recover the " +
    "account; their username becomes `Deleted member <id>` (with `-1`, `-2`, ... added if " +
    "that name is somehow taken); their about text, title, " +
    "signature, location, website, birthday, social handles, avatar and cover are removed and " +
    "what they wear is taken off; their follows in both directions end; the address's " +
    "delivery records (rejected addresses, failed sends), finished account emails, push " +
    "devices and the profile picture of the login are removed; their referrer link, and the " +
    "link of the members they referred, end (the referrer's count drops by one). What they " +
    "wrote (threads, posts, wall posts, messages) stays as it is under the new name, and " +
    "their ledger, warnings and log entries are kept. Not rewritten: `@name` mentions and " +
    "quotation attributions inside other members' posts, which keep the old name. It cannot " +
    "be undone. If a run stops part way, " +
    "run it again: it finishes what is left and writes no second log entry. The actor's own " +
    "password is required (five wrong answers in fifteen minutes from one session, twenty from " +
    "all their sessions, block further attempts). " +
    "Requires admin.members over the member, and also admin.permissions when the member holds " +
    "any administration permission; refused for the last member holding admin.permissions; " +
    "session actors only.",
  kind: "write",
  input: z.object({
    userId: Id,
    actorPassword: ActorPassword,
    reason: z.string().trim().min(1).max(1000),
  }),
  output: Ok,
});

export const usersDeleteOwnAccount = defineContract({
  name: "users.deleteOwnAccount",
  summary:
    "Close the signed-in member's own account for good: the same erasure as `users.adminErase` " +
    "(read its summary for what is removed and what stays), logged as `member.erase` with the " +
    "member as the actor and banned permanently like any erased account. The member's own " +
    "password is required (five wrong answers in fifteen minutes from one session, twenty from " +
    "all their sessions, block further attempts). It cannot be undone. Requires " +
    "profile.deleteAccount; refused for a super admin (the flag is handed on first) and for " +
    "the last member holding admin.permissions; session actors only, never an API key. Every " +
    "session of the member ends, the current one included. If a step after the first fails, " +
    "the account stays erased and banned and an administrator finishes it with " +
    "`users.adminErase`.",
  kind: "write",
  input: z.object({ password: ActorPassword }),
  output: Ok,
});

// Sanctions ----------------------------------------------------------------------------------

export const BAN_STATES = ["active", "expired", "lifted"] as const;

export const bansList = defineContract({
  name: "bans.list",
  summary:
    "The ban register, newest first: every ban with who gave it, why, when it ends and whether " +
    "it was lifted. `state` narrows it to bans in force, bans that ran out, or bans lifted by " +
    "hand; `userId` to one member. A page may be empty while `nextCursor` is set (the state " +
    "filter is applied to the rows examined); continue until it is null. Requires member.ban.",
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
      /** What the alert opens; null opens the alert list. */
      url: z.string().nullable(),
      audience: AnnouncementAudience,
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
    "after it, so a moderator can decide. The messages around it are only those a participant " +
    "would see (visible ones); deleted and other moderated messages are left out. Requires conversation.moderate and that the message " +
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
