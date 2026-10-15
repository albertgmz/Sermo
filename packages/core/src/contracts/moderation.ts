import * as z from "zod";
import { defineContract } from "../operation";
import {
  ActorPassword,
  ContentState,
  Id,
  moderationNotice,
  Ok,
  pageInput,
  Timestamp,
} from "./common";

export const ReportTarget = z.object({
  type: z.enum(["post", "profile_post", "profile_post_comment", "conversation_message", "user"]),
  id: Id,
});
export const ModerationTarget = z.object({
  type: z.enum(["thread", "post", "profile_post", "profile_post_comment", "conversation_message"]),
  id: Id,
});
const ReportState = z.enum(["open", "assigned", "resolved", "rejected"]);
const ReportGroup = z.object({
  id: Id,
  targetType: ReportTarget.shape.type,
  targetId: Id,
  state: ReportState,
  assignedToId: Id.nullable(),
  reportCount: z.number().int().nonnegative(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  resolvedAt: Timestamp.nullable(),
});
/** What a queue row says about its content, so the queue reads need no further lookup. */
const QueueContext = {
  /** Plain text taken from the content, at most 200 characters; empty when none can be shown. */
  excerpt: z.string().max(200),
  /**
   * Where it happened: a thread (`kind: "thread"`) or a member's profile (`kind: "profile"`,
   * `id` the member, `title` their name). Null for messages of a conversation, which are
   * never shown here, and for a profile the actor may not view.
   */
  where: z.object({ kind: z.enum(["thread", "profile"]), id: Id, title: z.string() }).nullable(),
};
const Report = z.object({ id: Id, reporterId: Id, reason: z.string(), createdAt: Timestamp });
const Page = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });
const Reason = z.string().trim().min(1).max(5000);

export const reportsCreate = defineContract({
  name: "reports.create",
  summary: "Report visible content or a user.",
  kind: "write",
  input: z.object({ target: ReportTarget, reason: Reason }),
  output: z.object({ id: Id, groupId: Id }),
});
export const reportsList = defineContract({
  name: "reports.list",
  summary:
    "Moderation report queue: each item is shown only with the permission to handle it " +
    "(forum.manageReports on its node, report.manageProfiles, conversation.moderate). " +
    "nodeId limits it to reports on content in that node. Each row carries `reportCount`, an " +
    "`excerpt` of the reported content and `where` it happened, from one batched lookup per " +
    "page (nothing for messages of a conversation, see reports.viewConversationMessage).",
  kind: "read",
  input: z.object({ state: ReportState.optional(), nodeId: Id.optional(), ...pageInput }),
  output: Page(ReportGroup.extend(QueueContext)),
});
export const reportsGet = defineContract({
  name: "reports.get",
  summary: "One report group and its reports for a moderator.",
  kind: "read",
  input: z.object({ groupId: Id }),
  output: ReportGroup.extend({ reports: z.array(Report) }),
});
export const reportsSetState = defineContract({
  name: "reports.setState",
  summary: "Assign, resolve, or reject a report group.",
  kind: "write",
  input: z.object({
    ...moderationNotice,
    groupId: Id,
    state: z.enum(["assigned", "resolved", "rejected"]),
    reason: z.string().max(5000).default(""),
    assigneeId: Id.optional(),
  }),
  output: ReportGroup,
});
export const approvalsList = defineContract({
  name: "approvals.list",
  summary:
    "Content awaiting approval that the actor may approve; nodeId limits it to content in that " +
    "node. Each row carries an `excerpt` and `where` it happened, from one batched lookup per " +
    "page (nothing for messages of a conversation).",
  kind: "read",
  input: z.object({ nodeId: Id.optional(), ...pageInput }),
  output: Page(
    z.object({
      type: ModerationTarget.shape.type,
      id: Id,
      authorId: Id,
      createdAt: Timestamp,
      ...QueueContext,
    }),
  ),
});
export const moderationSetState = defineContract({
  name: "moderation.setState",
  summary: "Change a content visibility state with a moderator log entry.",
  kind: "write",
  input: z.object({
    ...moderationNotice,
    target: ModerationTarget,
    state: ContentState,
    reason: z.string().max(5000).default(""),
  }),
  output: z.object({ changed: z.boolean() }),
});
export const moderationBulk = defineContract({
  name: "moderation.bulk",
  summary: "Moderate up to 100 items atomically.",
  kind: "write",
  input: z.object({
    ...moderationNotice,
    targets: z.array(ModerationTarget).min(1).max(100),
    action: z.enum(["delete", "restore", "approve", "move", "lock", "unlock"]),
    reason: z.string().max(5000).default(""),
    nodeId: Id.optional(),
  }),
  output: z.object({ changed: z.number().int().nonnegative() }),
});
export const moderatorLogList = defineContract({
  name: "moderatorLog.list",
  summary:
    "Read the append-only moderator log: everything with moderatorLog.view, otherwise the " +
    "entries of nodes where the actor has forum.viewLog. nodeId limits it to one node; " +
    "`actorId` to what one member did; `action` to actions that start with that text (for " +
    "example `settings.` or `navigation.`). A call examines a bounded number of entries, so a " +
    "page may be short, even empty, when few of them match: continue with `nextCursor` until " +
    "it is null.",
  kind: "read",
  input: z.object({
    nodeId: Id.optional(),
    actorId: Id.optional(),
    action: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_.]{1,60}$/)
      .optional(),
    ...pageInput,
  }),
  output: Page(
    z.object({
      id: Id,
      actorId: Id,
      action: z.string(),
      targetType: z.string(),
      targetId: Id,
      reason: z.string(),
      details: z.record(z.string(), z.unknown()),
      createdAt: Timestamp,
    }),
  ),
});
const WordFilter = z.object({
  id: Id,
  term: z.string(),
  action: z.enum(["replace", "moderate"]),
  replacement: z.string().nullable(),
  isActive: z.boolean(),
});
export const wordFiltersList = defineContract({
  name: "wordFilters.list",
  summary: "List configured word filters for moderators.",
  kind: "read",
  input: z.object({}),
  output: z.object({ items: z.array(WordFilter) }),
});
export const wordFiltersUpsert = defineContract({
  name: "wordFilters.upsert",
  summary: "Create or update a word filter. Administrators only.",
  kind: "write",
  input: z.object({
    term: z.string().trim().min(1).max(100),
    action: z.enum(["replace", "moderate"]),
    replacement: z.string().max(500).nullable().optional(),
    isActive: z.boolean().optional(),
  }),
  output: z.object({ id: Id }),
});
export const wordFiltersRemove = defineContract({
  name: "wordFilters.remove",
  summary: "Remove a word filter. Administrators only.",
  kind: "write",
  input: z.object({ filterId: Id }),
  output: Ok,
});
const Warning = z.object({
  id: Id,
  userId: Id,
  moderatorId: Id,
  points: z.number().int().positive(),
  reason: z.string(),
  createdAt: Timestamp,
  expiresAt: Timestamp.nullable(),
  /** The type the warning was given under; null for a custom warning or a deleted type. */
  typeId: Id.nullable(),
  /** The type's name in the viewer's language. */
  typeName: z.string().nullable(),
});
export const warningsCreate = defineContract({
  name: "warnings.create",
  summary:
    "Issue warning points. Requires member.warn over the member or, when it is about one of their posts " +
    "(`postId`, which must be theirs and visible to the moderator), forum.warn over the member " +
    "in that post's forum instead; the post is logged with the warning. The points, a type's or a custom value, may not exceed " +
    "warning.maxPoints, and a moderator gives at most warning.perDay warnings in 24 hours " +
    "(administrators have no limit by default). With a `typeId`, points, " +
    "expiry and reason default to the type's (a locked type refuses a different `points` or " +
    "any `expiresAt`); without one the warning is custom and needs `points` and a `reason`. " +
    "`expiresAt` omitted takes the type's expiry, null never expires. Warning actions whose " +
    "threshold the member's active points now reach are applied in the same transaction; an " +
    "action that cannot be applied (for instance a ban on the last administrator) refuses the " +
    "warning.",
  kind: "write",
  input: z.object({
    ...moderationNotice,
    userId: Id,
    /** The post the warning is about: it must be the member's, and forum.warn applies in its forum. */
    postId: Id.optional(),
    typeId: Id.optional(),
    points: z.number().int().positive().max(1000).optional(),
    reason: Reason.optional(),
    expiresAt: Timestamp.nullable().optional(),
  }),
  output: z.object({ id: Id, activePoints: z.number().int().nonnegative() }),
});
export const warningsDelete = defineContract({
  name: "warnings.delete",
  summary:
    "Delete a warning: it stops counting and disappears from the member's list. The timed group " +
    "memberships that automatic actions gave, and that the member's points no longer reach, are " +
    "taken back in the same transaction and the actions re-armed; a ban or restriction an action " +
    "applied stays (lift it with bans.lift / restrictions.lift). Requires " +
    "warning.delete over the member. Logged with the warning's points and reason.",
  kind: "write",
  input: z.object({ warningId: Id, reason: z.string().trim().max(1000).default("") }),
  output: z.object({ activePoints: z.number().int().nonnegative() }),
});
export const warningsExpire = defineContract({
  name: "warnings.expire",
  summary:
    "End a warning now: it stops counting but stays in the member's list. Conflict when it " +
    "has already expired. Automatic actions are taken back as for warnings.delete. Requires " +
    "warning.delete over the member.",
  kind: "write",
  input: z.object({ warningId: Id, reason: z.string().trim().max(1000).default("") }),
  output: z.object({ activePoints: z.number().int().nonnegative() }),
});
export const warningsList = defineContract({
  name: "warnings.list",
  summary: "Read a user's warnings with moderator or self access.",
  kind: "read",
  input: z.object({ userId: Id, ...pageInput }),
  output: Page(Warning),
});

const WarningType = z
  .object({
    id: Id,
    /** The name in the viewer's language. */
    name: z.string(),
    nameEn: z.string(),
    nameEs: z.string(),
    points: z.number().int().positive(),
    /** Days until a warning of this type expires; null = never. */
    expiryDays: z.number().int().positive().nullable(),
    defaultReason: z.string(),
    /** The moderator cannot change the points or the expiry. */
    locked: z.boolean(),
  })
  .meta({ id: "WarningType" });
const WarningTypeFields = {
  nameEn: z.string().trim().min(1).max(60),
  nameEs: z.string().trim().min(1).max(60),
  points: z.number().int().positive().max(1000),
  expiryDays: z.number().int().positive().max(3650).nullable().default(null),
  defaultReason: z.string().trim().max(5000).default(""),
  locked: z.boolean().default(false),
};
export const warningTypesList = defineContract({
  name: "warningTypes.list",
  summary:
    "The warning types, oldest first. Requires member.warn (to pick one) or admin.settings " +
    "(to manage them).",
  kind: "read",
  input: z.object({}),
  output: z.object({ items: z.array(WarningType) }),
});
export const warningTypesCreate = defineContract({
  name: "warningTypes.create",
  summary: "Create a warning type, named in English and Spanish. Requires admin.settings.",
  kind: "write",
  input: z.object(WarningTypeFields),
  output: WarningType,
});
export const warningTypesUpdate = defineContract({
  name: "warningTypes.update",
  summary:
    "Replace a warning type's settings. Warnings already given keep their own points and " +
    "expiry. Requires admin.settings.",
  kind: "write",
  input: z.object({ typeId: Id, ...WarningTypeFields }),
  output: WarningType,
});
export const warningTypesDelete = defineContract({
  name: "warningTypes.delete",
  summary:
    "Delete a warning type. Warnings given under it stay, as custom warnings. Requires " +
    "admin.settings.",
  kind: "write",
  input: z.object({ typeId: Id }),
  output: Ok,
});

const WarningAction = z
  .object({
    id: Id,
    /** Active warning points that trigger the action. */
    threshold: z.number().int().positive(),
    kind: z.enum(["ban", "group", "restriction"]),
    /** How long the ban, group membership or restriction lasts; null = permanent. */
    days: z.number().int().positive().nullable(),
    groupId: Id.nullable(),
    groupTitle: z.string().nullable(),
    restrictionKind: z.enum(["posting", "conversations", "profile_posts"]).nullable(),
  })
  .meta({ id: "WarningAction" });
const GROUP_GATE =
  " An action that adds a group also needs admin.members and the acting administrator's own " +
  "password in `actorPassword`, like users.setGroups (an API key is refused), for creating, " +
  "changing or deleting it, and a rank above the group's, so a group-adding action cannot be " +
  "reached with admin.settings alone. Ban and restriction actions need only admin.settings.";
const WarningActionFields = {
  threshold: z.number().int().positive().max(100_000),
  kind: WarningAction.shape.kind,
  /** Required: null is a permanent action, never a default. */
  days: z.number().int().positive().max(3650).nullable(),
  groupId: Id.nullable().default(null),
  restrictionKind: WarningAction.shape.restrictionKind.default(null),
};
export const warningActionsList = defineContract({
  name: "warningActions.list",
  summary: "The automatic warning actions, lowest threshold first. Requires admin.settings.",
  kind: "read",
  input: z.object({}),
  output: z.object({ items: z.array(WarningAction) }),
});
export const warningActionsCreate = defineContract({
  name: "warningActions.create",
  summary:
    "Create an automatic action: when a member's active warning points reach the threshold, " +
    "ban them, add them to a group (one ranked below the actor that does not decide " +
    "admin.permissions) or restrict them, for `days` or permanently. Each action fires once " +
    "per crossing. Requires admin.settings." +
    GROUP_GATE,
  kind: "write",
  input: z.object({ ...WarningActionFields, actorPassword: ActorPassword.optional() }),
  output: WarningAction,
});
export const warningActionsUpdate = defineContract({
  name: "warningActions.update",
  summary:
    "Replace an automatic action's settings; members it already acted on keep what it did. " +
    "Requires admin.settings." +
    GROUP_GATE,
  kind: "write",
  input: z.object({
    actionId: Id,
    ...WarningActionFields,
    actorPassword: ActorPassword.optional(),
  }),
  output: WarningAction,
});
export const warningActionsDelete = defineContract({
  name: "warningActions.delete",
  summary:
    "Delete an automatic action. Group memberships it added for a limited time end now; bans, " +
    "restrictions and permanent memberships stay. Requires admin.settings." +
    GROUP_GATE,
  kind: "write",
  input: z.object({ actionId: Id, actorPassword: ActorPassword.optional() }),
  output: Ok,
});
export const bansCreate = defineContract({
  name: "bans.create",
  summary:
    "Ban a user until `expiresAt`, or for good when it is null. Requires member.ban over the " +
    "member, and member.banMaxDays: the ban may not last longer than that many days from now " +
    "(-1 allows a permanent ban; a moderator's default is bounded, an administrator's is not).",
  kind: "write",
  input: z.object({
    ...moderationNotice,
    userId: Id,
    reason: Reason,
    expiresAt: Timestamp.nullable(),
  }),
  output: z.object({ id: Id }),
});
export const bansLift = defineContract({
  name: "bans.lift",
  summary: "Lift an active ban. Requires member.ban over the member.",
  kind: "write",
  input: z.object({ ...moderationNotice, banId: Id, reason: z.string().max(5000).default("") }),
  output: Ok,
});
export const postRevisionsList = defineContract({
  name: "postRevisions.list",
  summary:
    "Read previous post bodies. Moderators with node access, and authors with forum.viewOwnHistory for their own posts.",
  kind: "read",
  input: z.object({ postId: Id, ...pageInput }),
  output: Page(
    z.object({
      id: Id,
      postId: Id,
      editorId: Id,
      bodySource: z.string(),
      bodyHtml: z.string(),
      editedAt: Timestamp,
    }),
  ),
});
export const spamCleanupStart = defineContract({
  name: "spamCleanup.start",
  summary:
    "Queue a ban and cleanup of all a user's content. A conflict when the member's account was erased.",
  kind: "write",
  input: z.object({
    ...moderationNotice,
    userId: Id,
    reason: z.string().trim().min(1).max(5000).default("Spam cleanup"),
  }),
  output: z.object({ jobId: Id }),
});

// Thread bans ----------------------------------------------------------------------------------

export const ThreadBan = z
  .object({
    threadId: Id,
    userId: Id,
    moderatorId: Id,
    reason: z.string(),
    createdAt: Timestamp,
    expiresAt: Timestamp.nullable(),
  })
  .meta({ id: "ThreadBan" });

export const threadBansCreate = defineContract({
  name: "threadBans.create",
  summary:
    "Stop one member replying in one thread, with a reason and optional expiry. Requires " +
    "forum.threadBan on the thread's node over the member (hierarchy).",
  kind: "write",
  input: z.object({
    ...moderationNotice,
    threadId: Id,
    userId: Id,
    reason: Reason,
    expiresAt: Timestamp.nullable().default(null),
  }),
  output: ThreadBan,
});

export const threadBansLift = defineContract({
  name: "threadBans.lift",
  summary: "Lift a thread ban. Requires forum.threadBan on the thread's node.",
  kind: "write",
  input: z.object({ ...moderationNotice, threadId: Id, userId: Id }),
  output: Ok,
});

export const threadBansList = defineContract({
  name: "threadBans.list",
  summary: "Active bans in a thread. Requires forum.threadBan on the thread's node.",
  kind: "read",
  input: z.object({ threadId: Id }),
  output: z.object({ items: z.array(ThreadBan) }),
});

// Restrictions ---------------------------------------------------------------------------------

export const Restriction = z
  .object({
    id: Id,
    userId: Id,
    kind: z.enum(["posting", "conversations", "profile_posts"]),
    moderatorId: Id,
    reason: z.string(),
    createdAt: Timestamp,
    expiresAt: Timestamp.nullable(),
    liftedAt: Timestamp.nullable(),
    active: z.boolean(),
  })
  .meta({ id: "Restriction" });

export const restrictionsCreate = defineContract({
  name: "restrictions.create",
  summary:
    "Restrict a member, lighter than a ban: no posting, no starting conversations, or no " +
    "profile posts, with a reason and optional expiry. Requires member.restrict over the member.",
  kind: "write",
  input: z.object({
    ...moderationNotice,
    userId: Id,
    kind: Restriction.shape.kind,
    reason: Reason,
    expiresAt: Timestamp.nullable().default(null),
  }),
  output: Restriction,
});

export const restrictionsLift = defineContract({
  name: "restrictions.lift",
  summary: "Lift a restriction. Requires member.restrict over the member.",
  kind: "write",
  input: z.object({ ...moderationNotice, restrictionId: Id }),
  output: Restriction,
});

export const restrictionsList = defineContract({
  name: "restrictions.list",
  summary: "A member's restrictions, newest first: your own, or anyone's with warning.view.",
  kind: "read",
  input: z.object({ userId: Id }),
  output: z.object({ items: z.array(Restriction) }),
});

// Conversation reports -------------------------------------------------------------------------

export const ReportedMessage = z
  .object({
    id: Id,
    authorId: Id,
    authorUsername: z.string(),
    bodyHtml: z.string(),
    createdAt: Timestamp,
    /** The reported message itself (the others are context around it). */
    reported: z.boolean(),
  })
  .meta({ id: "ReportedMessage" });

export const reportsViewConversationMessage = defineContract({
  name: "reports.viewConversationMessage",
  summary:
    "The reported conversation message with up to 3 messages before and after it, while the " +
    "report group targets it. Requires conversation.moderate. Every call is written to the " +
    "moderator log (so it is a write); nothing else lets a non-participant read a conversation.",
  kind: "write",
  input: z.object({ groupId: Id }),
  output: z.object({ conversationId: Id, title: z.string(), messages: z.array(ReportedMessage) }),
});
