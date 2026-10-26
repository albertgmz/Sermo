import * as z from "zod";
import {
  CREDIT_BACKFILL_ERRORS,
  CREDIT_BACKFILL_MODES,
  CREDIT_BACKFILL_STATES,
  CREDIT_TAX_RUN_KINDS,
  CREDIT_TAX_RUN_STATES,
  CREDIT_TRANSACTION_TYPES,
  CREDIT_TRIGGERS,
} from "../db/schema";
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
 * Optional filters on the source content of a content trigger (see `CONTENT_CREDIT_TRIGGERS`: the
 * thread, reply, profile post or reacted-to item the rule pays for); each null = no filter. Content
 * that fails one pays nothing, and neither does it when it is hidden and restored. Dates are UTC
 * days, both inclusive; lengths count the characters of the content's plain text (BB code tags
 * excluded; a thread counts its first post).
 */
export const CreditRuleFilters = z
  .object({
    createdFrom: z.iso.date().nullable(),
    createdUntil: z.iso.date().nullable(),
    minLength: z.number().int().min(1).max(1_000_000).nullable(),
    maxLength: z.number().int().min(1).max(1_000_000).nullable(),
  })
  .meta({ id: "CreditRuleFilters" });

export type CreditRuleFiltersValue = z.output<typeof CreditRuleFilters>;

const NO_FILTERS = { createdFrom: null, createdUntil: null, minLength: null, maxLength: null };

/**
 * "When <trigger> happens, the member gains or loses <amount>." Several rules may share a
 * trigger; each applies on its own. Triggers:
 * - `thread_created`: the member started a thread.
 * - `reply_posted`: the member posted a reply (not a thread's first post).
 * - `reply_received`: someone else replied in the member's thread.
 * - `reaction_given`, `reaction_received`: a reaction with a non-negative score on any reactable
 *   content except a private conversation message.
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
    /** Filters on the content the rule pays for; see `CreditRuleFilters`. */
    filters: CreditRuleFilters,
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: "CreditRule" });

/** What a member needs to know about a credit rule: no id, state, dates or other administration. */
export const CreditWay = z
  .object({
    title: z.string(),
    trigger: CreditRule.shape.trigger,
    /** Signed and never 0. */
    amount: z.number().int(),
    /** At most `count` applications within the last `windowHours`; null = no limit. */
    limit: CreditRule.shape.limit,
    /** The forums the rule is restricted to that the viewer can see; empty = everywhere. */
    forums: z.array(z.object({ id: Id, title: z.string() })),
  })
  .meta({ id: "CreditWay" });

export const creditsWays = defineContract({
  name: "credits.ways",
  summary:
    "The active credit rules as a member-facing list of ways to earn (or lose) credits, in " +
    "the order of creditRules.list, at most 100. Open to everyone who can see the site, " +
    "guests included. A rule restricted to some forums lists only those the viewer can see, " +
    "and is left out when the viewer can see none of them.",
  kind: "read",
  input: Empty,
  output: z.object({ items: z.array(CreditWay) }),
});

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
  filters: z
    .object({
      createdFrom: CreditRuleFilters.shape.createdFrom.default(null),
      createdUntil: CreditRuleFilters.shape.createdUntil.default(null),
      minLength: CreditRuleFilters.shape.minLength.default(null),
      maxLength: CreditRuleFilters.shape.maxLength.default(null),
    })
    .refine(
      (filters) =>
        filters.createdFrom === null ||
        filters.createdUntil === null ||
        filters.createdFrom <= filters.createdUntil,
      "The from date cannot be after the until date.",
    )
    .refine(
      (filters) =>
        filters.minLength === null ||
        filters.maxLength === null ||
        filters.minLength <= filters.maxLength,
      "The minimum length cannot exceed the maximum length.",
    ),
};

/** The triggers about forum content, the only ones that accept a restriction to forums. */
export const FORUM_CREDIT_TRIGGERS: readonly (typeof CREDIT_TRIGGERS)[number][] = [
  "thread_created",
  "reply_posted",
  "reply_received",
  "reaction_given",
  "reaction_received",
];

/**
 * The triggers whose source is a piece of content, the only ones that accept `filters`: the forum
 * triggers and the profile post ones.
 */
export const CONTENT_CREDIT_TRIGGERS: readonly (typeof CREDIT_TRIGGERS)[number][] = [
  ...FORUM_CREDIT_TRIGGERS,
  "profile_post_created",
  "profile_post_received",
];

export const creditRulesList = defineContract({
  name: "creditRules.list",
  summary:
    "All credit rules, and every trigger with whether a rule on it accepts a restriction to " +
    "forums (`triggers`, `acceptsForums`: `nodeIds` on any other trigger is refused) and to " +
    "source filters (`acceptsFilters`: non-empty `filters` on any other trigger are refused). " +
    "Requires admin.creditRules.",
  kind: "read",
  input: Empty,
  output: z.object({
    items: z.array(CreditRule),
    triggers: z.array(
      z.object({
        id: CreditRule.shape.trigger,
        acceptsForums: z.boolean(),
        acceptsFilters: z.boolean(),
      }),
    ),
  }),
});

export const creditRulesCreate = defineContract({
  name: "creditRules.create",
  summary:
    "Create a credit rule. It applies to events from now on, never to past ones. `nodeIds` " +
    "must be existing forums and is accepted only for forum triggers. `filters` (created from or " +
    "until a UTC day, minimum or maximum plain-text length of the source content) are accepted " +
    "only for content triggers. Requires admin.creditRules.",
  kind: "write",
  input: z.object({
    ...RuleInput,
    isActive: RuleInput.isActive.default(true),
    limit: RuleInput.limit.default(null),
    nodeIds: RuleInput.nodeIds.default([]),
    filters: RuleInput.filters.default(NO_FILTERS),
  }),
  output: CreditRule,
});

export const creditRulesUpdate = defineContract({
  name: "creditRules.update",
  summary:
    "Change a credit rule (its trigger is fixed). Credits it already paid keep their amount, " +
    "including when they are later taken back or paid again; a change of filters applies to " +
    "later events only. Requires admin.creditRules.",
  kind: "write",
  input: z.object({
    ruleId: Id,
    title: RuleInput.title.optional(),
    amount: RuleInput.amount.optional(),
    isActive: RuleInput.isActive.optional(),
    limit: RuleInput.limit.optional(),
    nodeIds: RuleInput.nodeIds.optional(),
    /** Replaces all four filters at once; the ones left out are cleared. Omitted = unchanged. */
    filters: RuleInput.filters.optional(),
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

// Paying past activity -----------------------------------------------------------------------

/**
 * The triggers a payment of past activity pays: those with a history to read. `registered`,
 * `daily_activity` (no history of active days) and `warning_received` (no penalty for the past)
 * pay nothing.
 */
export const BACKFILL_CREDIT_TRIGGERS = [
  "thread_created",
  "reply_posted",
  "reply_received",
  "reaction_given",
  "reaction_received",
  "profile_post_created",
  "profile_post_received",
  "followed",
  "award_received",
] as const satisfies readonly (typeof CREDIT_TRIGGERS)[number][];

/** A whole number of credits that is not negative. */
const Credits = z.number().int().nonnegative();

/**
 * A run that pays past activity once (a preview only counts). For each active credit rule on a
 * trigger of `BACKFILL_CREDIT_TRIGGERS` it adds up what the rule would have paid, under its own
 * forums, filters and limit, for sources from `from` (inclusive) to `until` (exclusive, both UTC
 * days) made before the rule itself was created. A member is paid at most `cap` in all, less what
 * earlier payments of past activity paid them, in one `backfill` ledger row. Members are not
 * notified.
 */
export const CreditBackfill = z
  .object({
    id: Id,
    /** `preview` only counts and pays nothing; `apply` pays. */
    mode: z.enum(CREDIT_BACKFILL_MODES),
    /** `failed`: stopped (`error` says why); a new preview starts over. */
    state: z.enum(CREDIT_BACKFILL_STATES),
    /** The preview an apply pays; null for a preview. */
    previewId: Id.nullable(),
    from: z.iso.date(),
    until: z.iso.date(),
    cap: z.number().int().positive(),
    /** How far through the members the run is, from 0 to 1. */
    progress: z.number().min(0).max(1),
    startedAt: Timestamp,
    finishedAt: Timestamp.nullable(),
    /**
     * Why a failed run stopped: `permission` (its starter can no longer manage credit rules),
     * `mismatch` (a chunk did not match the run's progress), `error` (the job kept failing).
     */
    error: z.enum(CREDIT_BACKFILL_ERRORS).nullable(),
    /** The figures of the finished run (a preview: what an apply would pay); null before. */
    summary: z
      .object({
        /** Members paid, and the credits paid to them in all. */
        members: Credits,
        credits: Credits,
        /** Members whose activity adds up to more than the cap. */
        heldAtCap: Credits,
        /** What each trigger adds up to over every member, before the cap. */
        byTrigger: z.array(
          z.object({ trigger: z.enum(CREDIT_TRIGGERS), credits: z.number().int() }),
        ),
        /** What one member is paid, over the members paid: exact percentiles and the maximum. */
        paid: z.object({ p50: Credits, p90: Credits, p99: Credits, max: Credits }),
        /** The twenty members paid most, most first: their total before the cap, and their pay. */
        top: z.array(z.object({ user: UserSummary, total: z.number().int(), paid: Credits })),
      })
      .nullable(),
  })
  .meta({ id: "CreditBackfill" });

export const creditRulesBackfillPreview = defineContract({
  name: "creditRules.backfillPreview",
  summary:
    "Start a preview of a payment of past activity (see CreditBackfill): a background run that " +
    "counts what each member would be paid and pays nothing. Refused while another run is under " +
    "way, and when the dates do not include those of every payment of past activity already " +
    "made. The run counts with the active rules as they are when it starts. `from` must be " +
    "before `until`. Requires admin.creditRules.",
  kind: "write",
  input: z.object({
    /** The first day counted; default 2020-01-01. */
    from: z.iso.date().default("2020-01-01"),
    /** The first day not counted; default today (UTC). */
    until: z.iso.date().optional(),
    cap: z.number().int().min(1).max(1_000_000_000),
  }),
  output: CreditBackfill,
});

export const creditRulesBackfillApply = defineContract({
  name: "creditRules.backfillApply",
  summary:
    "Pay a finished preview: a background run with the preview's dates and cap that counts " +
    "again, with the active rules as they are when the payment starts, and pays each member once. A second payment of the same dates pays nothing more; a " +
    "higher cap pays only the difference. Refused while another run is under way. Requires " +
    "admin.creditRules.",
  kind: "write",
  input: z.object({ previewId: Id }),
  output: CreditBackfill,
});

export const creditRulesBackfillStatus = defineContract({
  name: "creditRules.backfillStatus",
  summary:
    "The latest payment of past activity (preview or apply), null when none was run, and the " +
    "dates the payments made so far cover (null when none paid). Requires admin.creditRules.",
  kind: "read",
  input: Empty,
  output: z.object({
    latest: CreditBackfill.nullable(),
    paidRange: z.object({ from: z.iso.date(), until: z.iso.date() }).nullable(),
  }),
});

// The monthly credit tax ---------------------------------------------------------------------

/**
 * A run of the monthly credit tax (see the `creditTax*` site settings) for the charge on
 * `chargeOn`. A member's charge is `creditTaxFee` when the balance is above `creditTaxMinimum`,
 * plus `creditTaxStep` percent of the balance (rounded down) per whole calendar month without a
 * visit between the month of the last visit (or of the sign-up, for a member who never visited)
 * and the month of the charge, at most 50 percent, and never more than the balance. A balance of
 * 0 or below is never charged; the guest account and erased accounts are exempt.
 */
export const CreditTaxRun = z
  .object({
    id: Id,
    /**
     * `charge` charged the members (one `tax` ledger row per member and month), `notice` warned
     * those whose charge would be more than the fee alone, `preview` only counted.
     */
    kind: z.enum(CREDIT_TAX_RUN_KINDS),
    /** The day of the charge the run is for: the 1st of a month (UTC). */
    chargeOn: z.iso.date(),
    /** `stopped`: the tax was turned off while the run was under way; `failed`: its job kept failing. */
    state: z.enum(CREDIT_TAX_RUN_STATES),
    /** The settings the run counts with, as they were when it started. */
    fee: Credits,
    minimum: Credits,
    step: z.number().int().min(0).max(50),
    /** How far through the members the run is, from 0 to 1. */
    progress: z.number().min(0).max(1),
    /** Members charged (warned; for a preview, who would be charged) so far, and the credits. */
    members: Credits,
    credits: Credits,
    /**
     * The twenty largest charges so far, largest first: the balance counted, the whole months
     * without a visit and the charge.
     */
    top: z.array(
      z.object({ user: UserSummary, balance: Credits, months: Credits, charge: Credits }),
    ),
    startedAt: Timestamp,
    finishedAt: Timestamp.nullable(),
  })
  .meta({ id: "CreditTaxRun" });

export const creditsTaxPreview = defineContract({
  name: "credits.taxPreview",
  summary:
    "Start a preview of the next charge of the monthly credit tax (see CreditTaxRun): a " +
    "background run that counts, with the settings as they are now (on or off), what each " +
    "member would be charged on the next 1st of a month if they did not visit before it, and " +
    "charges nothing. Refused while another preview is under way. Requires credits.adjust.",
  kind: "write",
  input: Empty,
  output: CreditTaxRun,
});

export const creditsTaxStatus = defineContract({
  name: "credits.taxStatus",
  summary:
    "Where the monthly credit tax stands: whether it is on, the day of its next charge (null " +
    "while it is off; turning it on charges first on the next 1st at least 7 days away), the latest " +
    "preview and the latest charge (null when none was run). Requires credits.adjust.",
  kind: "read",
  input: Empty,
  output: z.object({
    enabled: z.boolean(),
    nextChargeOn: z.iso.date().nullable(),
    preview: CreditTaxRun.nullable(),
    lastCharge: CreditTaxRun.nullable(),
  }),
});
