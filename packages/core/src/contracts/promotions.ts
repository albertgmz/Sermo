import * as z from "zod";
import { USER_PROMOTION_STATES } from "../db/schema";
import { defineContract } from "../operation";
import { Empty, Id, Ok, Page, pageInput, Timestamp } from "./common";

/** One condition of a promotion; `criterion` is an id from promotions.criteria. */
export const PromotionCriterion = z
  .object({
    criterion: z.string().min(1).max(50),
    /** Threshold (counts, days, points) or 1/0 for yes/no criteria. */
    value: z.number().int().min(0).max(1_000_000_000),
  })
  .meta({ id: "PromotionCriterion" });

export const Promotion = z
  .object({
    id: Id,
    title: z.string(),
    isActive: z.boolean(),
    /** All must hold. */
    criteria: z.array(PromotionCriterion),
    /** Secondary groups the promotion adds while its criteria hold. */
    groupIds: z.array(Id),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: "Promotion" });

export const CriterionDefinition = z
  .object({
    id: z.string(),
    /** Phrase keys. */
    label: z.string(),
    description: z.string(),
    /** How `value` is read: a minimum, a maximum, or yes/no (1 = must hold). */
    kind: z.enum(["atLeast", "atMost", "below", "boolean"]),
    unit: z.enum(["count", "days", "points", "boolean"]),
  })
  .meta({ id: "PromotionCriterionDefinition" });

const PromotionInput = {
  title: z.string().trim().min(1).max(100),
  isActive: z.boolean(),
  criteria: z.array(PromotionCriterion).min(1).max(20),
  groupIds: z.array(Id).min(1).max(20),
};

export const promotionsCriteria = defineContract({
  name: "promotions.criteria",
  summary: "Every criterion a promotion can use. Requires admin.promotions.",
  kind: "read",
  input: Empty,
  output: z.object({ items: z.array(CriterionDefinition) }),
});

export const promotionsList = defineContract({
  name: "promotions.list",
  summary: "All promotions. Requires admin.promotions.",
  kind: "read",
  input: Empty,
  output: z.object({ items: z.array(Promotion) }),
});

export const promotionsGet = defineContract({
  name: "promotions.get",
  summary: "One promotion. Requires admin.promotions.",
  kind: "read",
  input: z.object({ promotionId: Id }),
  output: Promotion,
});

export const promotionsCreate = defineContract({
  name: "promotions.create",
  summary:
    "Create a promotion: criteria (all must hold) and the secondary groups to add. Members are " +
    "evaluated by the next sweep, or right after their next relevant activity. Requires " +
    "admin.promotions; the guest group cannot be granted, nor groups ranked at or above the actor.",
  kind: "write",
  input: z.object({ ...PromotionInput, isActive: PromotionInput.isActive.default(true) }),
  output: Promotion,
});

export const promotionsUpdate = defineContract({
  name: "promotions.update",
  summary:
    "Change a promotion. Changing its groups moves members it already applies to on their next " +
    "evaluation. Requires admin.promotions.",
  kind: "write",
  input: z.object({
    promotionId: Id,
    title: PromotionInput.title.optional(),
    isActive: PromotionInput.isActive.optional(),
    criteria: PromotionInput.criteria.optional(),
    groupIds: PromotionInput.groupIds.optional(),
  }),
  output: Promotion,
});

export const promotionsDelete = defineContract({
  name: "promotions.delete",
  summary:
    "Delete a promotion and remove the groups it granted (hand-assigned groups are kept). " +
    "Requires admin.promotions.",
  kind: "write",
  input: z.object({ promotionId: Id }),
  output: Ok,
});

export const MemberPromotion = z
  .object({
    promotionId: Id,
    title: z.string(),
    /** Null when the promotion has never applied and the member is not exempt. */
    state: z.enum(USER_PROMOTION_STATES).nullable(),
    /** Whether the criteria hold now. */
    eligible: z.boolean(),
    /** Groups currently granted to the member by this promotion. */
    grantedGroupIds: z.array(Id),
  })
  .meta({ id: "MemberPromotion" });

export const promotionsMemberStatus = defineContract({
  name: "promotions.memberStatus",
  summary:
    "For one member, every promotion with its state and whether it applies now. Requires admin.promotions.",
  kind: "read",
  input: z.object({ userId: Id }),
  output: z.object({ items: z.array(MemberPromotion) }),
});

export const promotionsApply = defineContract({
  name: "promotions.apply",
  summary:
    "Change one member's promotion by hand: `promote` grants its groups and keeps them whatever " +
    "the criteria say; `demote` removes them and keeps the member out of it (as `exempt` does); " +
    "`exempt` excludes the member from the rule; `reset` returns the member to automatic " +
    "evaluation, which runs immediately. Requires admin.promotions over the member (hierarchy).",
  kind: "write",
  input: z.object({
    userId: Id,
    promotionId: Id,
    action: z.enum(["promote", "demote", "exempt", "reset"]),
  }),
  output: MemberPromotion,
});

export const PromotionLogEntry = z
  .object({
    id: Id,
    userId: Id,
    promotionId: Id,
    action: z.enum(["promote", "demote", "exempt", "reset"]),
    /** Null for automatic changes. */
    actorId: Id.nullable(),
    groupIds: z.array(Id),
    createdAt: Timestamp,
  })
  .meta({ id: "PromotionLogEntry" });

export const promotionsLog = defineContract({
  name: "promotions.log",
  summary:
    "Automatic and manual promotion changes, newest first, optionally for one member. Requires " +
    "admin.promotions.",
  kind: "read",
  input: z.object({ userId: Id.optional(), ...pageInput }),
  output: Page(PromotionLogEntry),
});

export const promotionsRun = defineContract({
  name: "promotions.run",
  summary:
    "Queue a sweep that evaluates every member against every active promotion now (it also runs " +
    "daily). Requires admin.promotions.",
  kind: "write",
  input: Empty,
  output: z.object({ queued: z.boolean() }),
});
