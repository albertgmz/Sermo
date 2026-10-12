import * as z from "zod";
import { AWARD_TIERS } from "../db/schema";
import { defineContract } from "../operation";
import { Empty, Id, Ok, Page, pageInput, Timestamp, UserSummary } from "./common";
import { CriterionDefinition, PromotionCriterion } from "./promotions";

/**
 * An award (achievements are awards too). A stackable award can be granted to the same member
 * any number of times; any other award once.
 */
export const Award = z
  .object({
    id: Id,
    name: z.string(),
    description: z.string(),
    /** An icon key or URL the client resolves. */
    icon: z.string(),
    tier: z.enum(AWARD_TIERS),
    /** XP each grant adds to the member's total. */
    xp: z.number().int().nonnegative(),
    /** Credits each grant pays the member. */
    credits: z.number().int().nonnegative(),
    isStackable: z.boolean(),
    isActive: z.boolean(),
    /**
     * Granted automatically, once per member, when all hold; empty = by hand only. An award the
     * criteria granted is never taken back when they stop holding, and never granted again by
     * them after it was revoked.
     */
    criteria: z.array(PromotionCriterion),
    /** Grants currently held, over all members. */
    grantCount: z.number().int().nonnegative(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: "Award" });

/** One grant of an award to a member. */
export const MemberAward = z
  .object({
    id: Id,
    user: UserSummary,
    award: Award,
    /** Null for an automatic grant. */
    grantedBy: UserSummary.nullable(),
    reason: z.string(),
    grantedAt: Timestamp,
  })
  .meta({ id: "MemberAward" });

const AwardInput = {
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500),
  icon: z.string().trim().max(200),
  tier: Award.shape.tier,
  xp: z.number().int().min(0).max(1_000_000),
  credits: z.number().int().min(0).max(1_000_000),
  isStackable: z.boolean(),
  isActive: z.boolean(),
  criteria: z.array(PromotionCriterion).max(20),
};

export const awardsList = defineContract({
  name: "awards.list",
  summary:
    "Every active award, best tier first (legendary, gold, silver, bronze), then by XP " +
    "descending. With admin.awards, inactive awards too. Requires profile.view.",
  kind: "read",
  input: Empty,
  output: z.object({ items: z.array(Award) }),
});

export const awardsGet = defineContract({
  name: "awards.get",
  summary: "One award. Inactive awards are visible only with admin.awards. Requires profile.view.",
  kind: "read",
  input: z.object({ awardId: Id }),
  output: Award,
});

export const awardsHolders = defineContract({
  name: "awards.holders",
  summary:
    "The grants of one award that members currently hold, newest first (a member holding a " +
    "stackable award several times appears once per grant). Requires profile.view.",
  kind: "read",
  input: z.object({ awardId: Id, ...pageInput }),
  output: Page(MemberAward),
});

export const awardsCriteria = defineContract({
  name: "awards.criteria",
  summary: "Every criterion an automatic award can use. Requires admin.awards.",
  kind: "read",
  input: Empty,
  output: z.object({ items: z.array(CriterionDefinition) }),
});

export const awardsCreate = defineContract({
  name: "awards.create",
  summary:
    "Create an award. With criteria, members are evaluated by the next sweep or after their " +
    "next relevant activity. Requires admin.awards.",
  kind: "write",
  input: z.object({
    ...AwardInput,
    description: AwardInput.description.default(""),
    icon: AwardInput.icon.default(""),
    xp: AwardInput.xp.default(0),
    credits: AwardInput.credits.default(0),
    isStackable: AwardInput.isStackable.default(false),
    isActive: AwardInput.isActive.default(true),
    criteria: AwardInput.criteria.default([]),
  }),
  output: Award,
});

export const awardsUpdate = defineContract({
  name: "awards.update",
  summary:
    "Change an award. Grants already made keep the XP and credits they were made with. An " +
    "award held more than once by some member cannot stop being stackable. Requires admin.awards.",
  kind: "write",
  input: z.object({
    awardId: Id,
    name: AwardInput.name.optional(),
    description: AwardInput.description.optional(),
    icon: AwardInput.icon.optional(),
    tier: AwardInput.tier.optional(),
    xp: AwardInput.xp.optional(),
    credits: AwardInput.credits.optional(),
    isStackable: AwardInput.isStackable.optional(),
    isActive: AwardInput.isActive.optional(),
    criteria: AwardInput.criteria.optional(),
  }),
  output: Award,
});

export const awardsDelete = defineContract({
  name: "awards.delete",
  summary:
    "Delete an award that was never granted. One that was granted (even if since revoked) can " +
    "only be deactivated. Requires admin.awards.",
  kind: "write",
  input: z.object({ awardId: Id }),
  output: Ok,
});

export const awardsRun = defineContract({
  name: "awards.run",
  summary:
    "Queue a sweep that evaluates every member against every active award with criteria now " +
    "(it also runs daily). Requires admin.awards.",
  kind: "write",
  input: Empty,
  output: z.object({ queued: z.boolean() }),
});

export const awardsGrant = defineContract({
  name: "awards.grant",
  summary:
    "Grant an active award to a member by hand: adds its XP to the member's total and pays its " +
    "credits through the ledger. A member who already holds an award that is not stackable gets " +
    "a conflict. Requires award.grant.",
  kind: "write",
  input: z.object({ userId: Id, awardId: Id, reason: z.string().trim().max(500).default("") }),
  output: MemberAward,
});

export const awardsRevoke = defineContract({
  name: "awards.revoke",
  summary:
    "Revoke one grant: takes back the XP and the credits that grant gave (the balance may go " +
    "below zero). Requires award.grant.",
  kind: "write",
  input: z.object({ memberAwardId: Id, reason: z.string().trim().max(500).default("") }),
  output: Ok,
});

/** An award a member holds, with how many times. */
export const HeldAward = z
  .object({
    award: Award,
    count: z.number().int().positive(),
    lastGrantedAt: Timestamp,
  })
  .meta({ id: "HeldAward" });

export const awardsMember = defineContract({
  name: "awards.member",
  summary:
    "A member's XP total and the awards they hold with a count each, best tier first, then by " +
    "XP descending. Requires being able to view the member's profile (not found otherwise).",
  kind: "read",
  input: z.object({ userId: Id }),
  output: z.object({ xp: z.number().int().nonnegative(), items: z.array(HeldAward) }),
});

export const awardsMemberGrants = defineContract({
  name: "awards.memberGrants",
  summary:
    "The grants a member currently holds, one per grant, newest first. Requires being able to " +
    "view the member's profile (not found otherwise).",
  kind: "read",
  input: z.object({ userId: Id, ...pageInput }),
  output: Page(MemberAward),
});
