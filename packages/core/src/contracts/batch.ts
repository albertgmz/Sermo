import * as z from "zod";
import { defineContract } from "../operation";
import { ActorPassword, Id, UserSummary } from "./common";
import { NonEmptyCriteriaRule } from "./criteria";

/*
 * Staff acting on many members at once ("batch update members"), and the shape of the answer
 * every batch of member actions gives: one outcome per member.
 */

/** The most members one run names or changes. */
export const BATCH_MEMBER_LIMIT = 100;

/** The most members a criteria selection looks at in one run. */
export const BATCH_SCAN_LIMIT = 10_000;

export const MEMBER_OUTCOME_STATUSES = ["done", "skipped", "failed"] as const;

/**
 * What happened to one member of a batch: `done` (changed), `skipped` (a rule says no: the
 * member outranks the actor, is the actor, is a super admin, was erased, has nothing to change,
 * or the actor lacks the permission over them) or `failed` (the change was tried and broke, or
 * the name matched nobody: `userId` is then null). `message` says why for the last two.
 */
export const MemberOutcome = z
  .object({
    userId: Id.nullable(),
    name: z.string(),
    status: z.enum(MEMBER_OUTCOME_STATUSES),
    message: z.string().nullable(),
  })
  .meta({ id: "MemberOutcome" });

export const MemberOutcomes = z
  .object({
    items: z.array(MemberOutcome),
    done: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  })
  .meta({ id: "MemberOutcomes" });

/**
 * Which members a preview looks for: those matching a rule of the criteria engine (never empty,
 * and only the criteria that are cheap to check while a request is served), or a list of ids and
 * usernames (a word of digits only is an id). A criteria run goes through the members in id order
 * starting after `after`, looks at no more than `BATCH_SCAN_LIMIT` of them and takes the first
 * `BATCH_MEMBER_LIMIT` that match; the answer's `next` says where to resume. The update acts on
 * the ids the preview returned, never on a selection.
 */
export const MemberSelection = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("criteria"),
      rule: NonEmptyCriteriaRule,
      after: Id.optional(),
    }),
    z.object({
      kind: z.literal("list"),
      members: z.array(z.string().trim().min(1).max(64)).min(1).max(BATCH_MEMBER_LIMIT),
    }),
  ])
  .meta({ id: "MemberSelection" });

export const BatchAction = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("setGroup"), groupId: Id }),
    z.object({ type: z.literal("addGroup"), groupId: Id }),
    z.object({ type: z.literal("removeGroup"), groupId: Id }),
    /** Null takes the custom title off. */
    z.object({ type: z.literal("setTitle"), title: z.string().trim().max(100).nullable() }),
    z.object({ type: z.literal("removeAvatar") }),
    z.object({ type: z.literal("removeSignature") }),
    /** `days` null bans for good. */
    z.object({
      type: z.literal("ban"),
      days: z.number().int().min(1).max(3650).nullable(),
      notify: z.boolean().default(true),
    }),
    z.object({ type: z.literal("liftBans"), notify: z.boolean().default(true) }),
    z.object({ type: z.literal("delete") }),
  ])
  .meta({ id: "BatchAction" });

export const usersBatchPreview = defineContract({
  name: "users.batchPreview",
  summary:
    "Who a batch would act on, without changing anything (a POST, because the selection is a " +
    "body): up to 100 members matching the selection (a criteria selection looks at no more than " +
    "10,000 members in id order after `after`), each with their id and username (it lists the " +
    "actor, super admins and members the actor may not act on too: the run skips them and says " +
    "so), the names of a list that matched nobody in `unknown`, and `next`: the id to resume a " +
    "criteria selection after, null when the members are all looked at or the selection is a " +
    "list. `users.batchUpdate` acts on exactly these ids. A rule that holds a criterion too heavy " +
    "to check while a request is served (the ones that count a member's history, which the " +
    "promotions and awards run in the background) is refused, naming it. Erased accounts are " +
    "never selected by criteria. Requires admin.members.",
  kind: "read",
  input: z.object({ selection: MemberSelection }),
  output: z.object({
    items: z.array(UserSummary),
    unknown: z.array(z.string()),
    next: Id.nullable(),
  }),
});

export const usersBatchUpdate = defineContract({
  name: "users.batchUpdate",
  summary:
    "Apply one action to up to 100 members, named by the ids `users.batchPreview` returned (the " +
    "rule or list is not read again, so the run acts on what was previewed): set the primary " +
    "group, add or remove a secondary group, set or clear the custom title, remove the avatar, " +
    "remove the signature, ban (for `days`, or for good with null; the ban obeys " +
    "member.banMaxDays), lift every active ban, or erase the account (the erasure of " +
    "`users.adminErase`). Each member goes through the permission and hierarchy rules of the " +
    "single action and is one transaction (an erasure, several): a member the actor may not act " +
    "on is skipped and reported, and the rest go on. Super admins and the actor are always " +
    "skipped. Each member changed is one moderator log entry, as the single action writes it. " +
    "Answers one outcome per member; an id that is no member is failed. An erasure that stopped " +
    "part way is finished by running it again. Groups need " +
    "admin.members and the actor's own password (session actors only, as `users.setGroups`); " +
    "bans and lifting need member.ban; erasing needs admin.members, a reason and the actor's " +
    "own password (session actors only). `reason` is logged with the change (the group actions log none) and, for a ban, sent to the member. " +
    "Requires admin.members.",
  kind: "write",
  input: z.object({
    userIds: z.array(Id).min(1).max(BATCH_MEMBER_LIMIT),
    action: BatchAction,
    reason: z.string().trim().max(1000).default(""),
    actorPassword: ActorPassword.optional(),
  }),
  output: MemberOutcomes,
});
