import * as z from "zod";
import { USER_PROMOTION_STATES } from "../db/schema";
import { defineContract } from "../operation";
import { ActorPassword, Empty, Id, Ok, Page, pageInput, Timestamp } from "./common";
import { CriteriaRule, CriterionDefinition, NonEmptyCriteriaRule } from "./criteria";

const CONFIRM =
  " `actorPassword` is the acting administrator's own password: it is verified under " +
  "the same wrong-answer limit as users.adminUpdateIdentity, and a wrong one changes nothing. A " +
  "browser session (session cookie) must send it (missing: a validation error naming " +
  "actorPassword). An API key or token cannot make this change: it is refused whether or not " +
  "it sends a password.";

export const Promotion = z
  .object({
    id: Id,
    title: z.string(),
    isActive: z.boolean(),
    /** Who the promotion applies to. A new or changed rule has at least one condition. */
    rule: CriteriaRule,
    /** Secondary groups the promotion adds while its rule holds. */
    groupIds: z.array(Id),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: "Promotion" });

const PromotionInput = {
  title: z.string().trim().min(1).max(100),
  isActive: z.boolean(),
  rule: NonEmptyCriteriaRule,
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
    "Create a promotion: a rule (match all or any of its conditions) and the secondary groups to add. Members are " +
    "evaluated by the next sweep, or right after their next relevant activity. Requires " +
    "admin.promotions; the guest group cannot be granted, nor groups ranked at or above the actor." +
    CONFIRM,
  kind: "write",
  input: z.object({
    ...PromotionInput,
    isActive: PromotionInput.isActive.default(true),
    actorPassword: ActorPassword.optional(),
  }),
  output: Promotion,
});

export const promotionsUpdate = defineContract({
  name: "promotions.update",
  summary:
    "Change a promotion. Changing its groups moves members it already applies to on their next " +
    "evaluation. Requires admin.promotions." +
    CONFIRM,
  kind: "write",
  input: z.object({
    promotionId: Id,
    title: PromotionInput.title.optional(),
    isActive: PromotionInput.isActive.optional(),
    rule: PromotionInput.rule.optional(),
    groupIds: PromotionInput.groupIds.optional(),
    actorPassword: ActorPassword.optional(),
  }),
  output: Promotion,
});

export const promotionsDelete = defineContract({
  name: "promotions.delete",
  summary:
    "Delete a promotion and remove the groups it granted (hand-assigned groups are kept). " +
    "Requires admin.promotions." +
    CONFIRM,
  kind: "write",
  input: z.object({ promotionId: Id, actorPassword: ActorPassword.optional() }),
  output: Ok,
});

export const MemberPromotion = z
  .object({
    promotionId: Id,
    title: z.string(),
    /** Null when the promotion has never applied and the member is not exempt. */
    state: z.enum(USER_PROMOTION_STATES).nullable(),
    /** Whether the rule holds now. */
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
    "evaluation, which runs immediately. Requires admin.promotions, and admin.members over the " +
    "member (hierarchy)." +
    CONFIRM,
  kind: "write",
  input: z.object({
    userId: Id,
    promotionId: Id,
    action: z.enum(["promote", "demote", "exempt", "reset"]),
    actorPassword: ActorPassword.optional(),
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
