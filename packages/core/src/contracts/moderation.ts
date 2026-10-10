import * as z from "zod";
import { defineContract } from "../operation";
import { ContentState, Id, moderationNotice, Ok, pageInput, Timestamp } from "./common";

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
    "nodeId limits it to reports on content in that node.",
  kind: "read",
  input: z.object({ state: ReportState.optional(), nodeId: Id.optional(), ...pageInput }),
  output: Page(ReportGroup),
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
    "Content awaiting approval that the actor may approve; nodeId limits it to content in that node.",
  kind: "read",
  input: z.object({ nodeId: Id.optional(), ...pageInput }),
  output: Page(
    z.object({ type: ModerationTarget.shape.type, id: Id, authorId: Id, createdAt: Timestamp }),
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
    "entries of nodes where the actor has forum.viewLog. nodeId limits it to one node.",
  kind: "read",
  input: z.object({ nodeId: Id.optional(), ...pageInput }),
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
});
export const warningsCreate = defineContract({
  name: "warnings.create",
  summary: "Issue warning points that may trigger a temporary ban.",
  kind: "write",
  input: z.object({
    ...moderationNotice,
    userId: Id,
    points: z.number().int().positive().max(1000),
    reason: Reason,
    expiresAt: Timestamp.nullable().optional(),
  }),
  output: z.object({ id: Id, activePoints: z.number().int().nonnegative() }),
});
export const warningsList = defineContract({
  name: "warnings.list",
  summary: "Read a user's warnings with moderator or self access.",
  kind: "read",
  input: z.object({ userId: Id, ...pageInput }),
  output: Page(Warning),
});
export const bansCreate = defineContract({
  name: "bans.create",
  summary: "Temporarily or permanently ban a user. Administrators only.",
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
  summary: "Lift an active ban. Administrators only.",
  kind: "write",
  input: z.object({ ...moderationNotice, banId: Id, reason: z.string().max(5000).default("") }),
  output: Ok,
});
export const postRevisionsList = defineContract({
  name: "postRevisions.list",
  summary: "Read previous post bodies. Moderators with node access only.",
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
  summary: "Queue a ban and cleanup of all a user's content.",
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
