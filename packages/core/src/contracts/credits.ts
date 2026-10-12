import * as z from "zod";
import { CREDIT_TRANSACTION_TYPES, CREDIT_TRIGGERS } from "../db/schema";
import { defineContract } from "../operation";
import { Empty, Id, Ok, Page, pageInput, Timestamp, UserSummary } from "./common";

// Ledger -------------------------------------------------------------------------------------

/** One row of the credit ledger. Rows are never changed or removed. */
export const CreditTransaction = z
  .object({
    id: Id,
    userId: Id,
    /** Signed: positive paid the member, negative charged them. */
    amount: z.number().int(),
    /** The member's balance right after this row. */
    balanceAfter: z.number().int(),
    type: z.enum(CREDIT_TRANSACTION_TYPES),
    /** What caused it (a credit rule, an award grant, a shop purchase, ...), when known. */
    source: z.object({ type: z.string(), id: Id }).nullable(),
    /** Who did it; null for the system. */
    actor: UserSummary.nullable(),
    reason: z.string(),
    createdAt: Timestamp,
  })
  .meta({ id: "CreditTransaction" });

export const creditsHistory = defineContract({
  name: "credits.history",
  summary:
    "The signed-in member's credit balance and ledger, newest first. Every member sees their own.",
  kind: "read",
  input: z.object({ ...pageInput }),
  output: Page(CreditTransaction).extend({ balance: z.number().int() }),
});

export const creditsLedger = defineContract({
  name: "credits.ledger",
  summary:
    "The credit ledger of one member (with `userId`; the response then carries their balance) " +
    "or of everyone, newest first. Requires credits.viewAny.",
  kind: "read",
  input: z.object({ userId: Id.optional(), ...pageInput }),
  output: Page(CreditTransaction).extend({
    /** The member's balance; null without `userId`. */
    balance: z.number().int().nullable(),
  }),
});

export const creditsAdjust = defineContract({
  name: "credits.adjust",
  summary:
    "Give (positive) or take (negative) credits by hand, with a reason. Taking more than the " +
    "member has leaves a negative balance. Requires credits.adjust.",
  kind: "write",
  input: z.object({
    userId: Id,
    amount: z
      .number()
      .int()
      .min(-1_000_000_000)
      .max(1_000_000_000)
      .refine((value) => value !== 0, "The amount cannot be 0."),
    reason: z.string().trim().min(1).max(500),
  }),
  output: CreditTransaction,
});

export const creditsRecalculate = defineContract({
  name: "credits.recalculate",
  summary:
    "Queue the job that recomputes every balance from the ledger and repairs any that differ " +
    "(it also runs daily). Requires credits.adjust.",
  kind: "write",
  input: Empty,
  output: z.object({ queued: z.boolean() }),
});

// Rules --------------------------------------------------------------------------------------

/**
 * "When <trigger> happens, the member gains or loses <amount>." Several rules may share a
 * trigger; each applies on its own. Triggers:
 * - `thread_created`: the member started a thread.
 * - `reply_posted`: the member posted a reply (not a thread's first post).
 * - `reply_received`: someone else replied in the member's thread.
 * - `reaction_given`, `reaction_received`: a reaction on any reactable content.
 * - `profile_post_created`: the member posted on another member's profile.
 * - `profile_post_received`: another member posted on the member's profile.
 * - `followed`: another member started following the member.
 * - `registered`: the member's account was created.
 * - `daily_activity`: the member's first activity of a UTC day.
 * - `warning_received`: the member was warned.
 * - `award_received`: the member was granted an award.
 *
 * A rule pays a member at most once per source (the thread, the post, the reaction of one member
 * on one item, the follower, the warning, the award grant, the day), however often its event is
 * processed. What a piece of content paid is taken back when the content stops being visible
 * and paid again when it is restored. Content awaiting approval pays when it is approved.
 */
export const CreditRule = z
  .object({
    id: Id,
    title: z.string(),
    trigger: z.enum(CREDIT_TRIGGERS),
    /** Signed and never 0. */
    amount: z.number().int(),
    isActive: z.boolean(),
    /** At most `count` applications per member within the last `windowHours`; null = no limit. */
    limit: z
      .object({
        count: z.number().int().min(1).max(1_000_000),
        windowHours: z.number().int().min(1).max(8760),
      })
      .nullable(),
    /**
     * Forums the rule is restricted to; empty = everywhere. Only for triggers about forum
     * content: thread_created, reply_posted, reply_received and, for reactions on posts,
     * reaction_given and reaction_received (a restricted rule ignores other reactions).
     */
    nodeIds: z.array(Id),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: "CreditRule" });

const RuleInput = {
  title: z.string().trim().min(1).max(100),
  trigger: CreditRule.shape.trigger,
  amount: z
    .number()
    .int()
    .min(-1_000_000)
    .max(1_000_000)
    .refine((value) => value !== 0, "The amount cannot be 0."),
  isActive: z.boolean(),
  limit: CreditRule.shape.limit,
  nodeIds: z.array(Id).max(100),
};

export const creditRulesList = defineContract({
  name: "creditRules.list",
  summary: "All credit rules. Requires admin.creditRules.",
  kind: "read",
  input: Empty,
  output: z.object({ items: z.array(CreditRule) }),
});

export const creditRulesCreate = defineContract({
  name: "creditRules.create",
  summary:
    "Create a credit rule. It applies to events from now on, never to past ones. `nodeIds` " +
    "must be existing forums and is accepted only for forum triggers. Requires admin.creditRules.",
  kind: "write",
  input: z.object({
    ...RuleInput,
    isActive: RuleInput.isActive.default(true),
    limit: RuleInput.limit.default(null),
    nodeIds: RuleInput.nodeIds.default([]),
  }),
  output: CreditRule,
});

export const creditRulesUpdate = defineContract({
  name: "creditRules.update",
  summary:
    "Change a credit rule (its trigger is fixed). Credits it already paid keep their amount, " +
    "including when they are later taken back or paid again. Requires admin.creditRules.",
  kind: "write",
  input: z.object({
    ruleId: Id,
    title: RuleInput.title.optional(),
    amount: RuleInput.amount.optional(),
    isActive: RuleInput.isActive.optional(),
    limit: RuleInput.limit.optional(),
    nodeIds: RuleInput.nodeIds.optional(),
  }),
  output: CreditRule,
});

export const creditRulesDelete = defineContract({
  name: "creditRules.delete",
  summary:
    "Delete a credit rule. Credits it paid stay, and are still taken back if their content is " +
    "hidden. Requires admin.creditRules.",
  kind: "write",
  input: z.object({ ruleId: Id }),
  output: Ok,
});
