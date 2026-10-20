import * as z from "zod";
import { AWARD_TIERS } from "../db/schema";
import { defineContract } from "../operation";
import { Empty, Id, Ok, Page, pageInput, Timestamp, UserSummary } from "./common";
import { CriteriaRule, CriterionDefinition } from "./criteria";
import { ImageReference } from "./images";

/**
 * What a group of awards rewards ("By posts", "Welcome", ...). Awards are listed under their
 * category, categories by ascending `position` (then id), awards without one last.
 */
export const AwardCategory = z
  .object({
    id: Id,
    title: z.string(),
    description: z.string(),
    position: z.number().int(),
    /** Awards in it that the viewer can see (inactive ones only with admin.awards). */
    awardCount: z.number().int().nonnegative(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: "AwardCategory" });

/** The category an award is listed under. */
export const AwardCategoryRef = z
  .object({ id: Id, title: z.string() })
  .meta({ id: "AwardCategoryRef" });

/**
 * An award (achievements are awards too). A stackable award can be granted to the same member
 * any number of times; any other award once.
 */
export const Award = z
  .object({
    id: Id,
    name: z.string(),
    description: z.string(),
    /** A key of the site's icon set the client draws; empty for the default medal. */
    icon: z.string(),
    /** The award's picture (images.setAwardImage), or null. */
    image: ImageReference,
    /** Its rarity, for the colours of its icon; awards are grouped by category, not by tier. */
    tier: z.enum(AWARD_TIERS),
    /** Null when the award has no category. */
    category: AwardCategoryRef.nullable(),
    /** XP each grant adds to the member's total. */
    xp: z.number().int().nonnegative(),
    /** Credits each grant pays the member. */
    credits: z.number().int().nonnegative(),
    isStackable: z.boolean(),
    isActive: z.boolean(),
    /**
     * Granted automatically, once per member, when the rule holds; no conditions = by hand only.
     * An award the rule granted is never taken back when it stops holding, and never granted
     * again by it after it was revoked. Only shown with admin.awards, empty otherwise.
     */
    rule: CriteriaRule,
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
  /** Empty, or a key of the site's icon set; any other text is refused when it is set. */
  icon: z.string().trim().max(200),
  tier: Award.shape.tier,
  /** An existing award category, or null for none. */
  categoryId: Id.nullable(),
  xp: z.number().int().min(0).max(1_000_000),
  credits: z.number().int().min(0).max(1_000_000),
  isStackable: z.boolean(),
  isActive: z.boolean(),
  rule: CriteriaRule,
};

export const awardsList = defineContract({
  name: "awards.list",
  summary:
    "Every active award, by category in the categories' order (awards without one last), " +
    "easiest first inside a category: awards whose rule counts progress (at least N posts, days, " +
    "reactions...) first, by N (the highest N of an all rule, the lowest of an any rule), then by " +
    "XP ascending, then by name. With admin.awards, " +
    "inactive awards too. Requires site.view and profile.view.",
  kind: "read",
  input: Empty,
  output: z.object({ items: z.array(Award) }),
});

export const awardsGet = defineContract({
  name: "awards.get",
  summary:
    "One award. Inactive awards are visible only with admin.awards. Requires site.view and profile.view.",
  kind: "read",
  input: z.object({ awardId: Id }),
  output: Award,
});

export const awardsHolders = defineContract({
  name: "awards.holders",
  summary:
    "The grants of one award that members currently hold, newest first (a member holding a " +
    "stackable award several times appears once per grant). Requires site.view, profile.view and " +
    "member.viewList.",
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
    "Create an award. With conditions in its rule, members are evaluated by the next sweep or after their " +
    "next relevant activity. Requires admin.awards.",
  kind: "write",
  input: z.object({
    ...AwardInput,
    description: AwardInput.description.default(""),
    icon: AwardInput.icon.default(""),
    categoryId: AwardInput.categoryId.default(null),
    xp: AwardInput.xp.default(0),
    credits: AwardInput.credits.default(0),
    isStackable: AwardInput.isStackable.default(false),
    isActive: AwardInput.isActive.default(true),
    rule: AwardInput.rule.default({ match: "all", conditions: [] }),
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
    categoryId: AwardInput.categoryId.optional(),
    xp: AwardInput.xp.optional(),
    credits: AwardInput.credits.optional(),
    isStackable: AwardInput.isStackable.optional(),
    isActive: AwardInput.isActive.optional(),
    rule: AwardInput.rule.optional(),
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
    "Queue a sweep that evaluates every member against every active award with conditions now " +
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

const CategoryInput = {
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500),
  position: z.number().int().min(0).max(1_000_000),
};

export const awardCategoriesList = defineContract({
  name: "awardCategories.list",
  summary:
    "The award categories in display order (position, then id), each with how many awards the " +
    "viewer can see in it. With admin.awards every category, empty ones included; anyone else " +
    "sees only those holding an active award. Requires site.view and profile.view.",
  kind: "read",
  input: Empty,
  output: z.object({ items: z.array(AwardCategory) }),
});

export const awardCategoriesCreate = defineContract({
  name: "awardCategories.create",
  summary:
    "Create an award category. Without a position it goes after the last one. Requires " +
    "admin.awards.",
  kind: "write",
  input: z.object({
    ...CategoryInput,
    description: CategoryInput.description.default(""),
    position: CategoryInput.position.optional(),
  }),
  output: AwardCategory,
});

export const awardCategoriesUpdate = defineContract({
  name: "awardCategories.update",
  summary: "Rename, describe or move an award category. Requires admin.awards.",
  kind: "write",
  input: z.object({
    categoryId: Id,
    title: CategoryInput.title.optional(),
    description: CategoryInput.description.optional(),
    position: CategoryInput.position.optional(),
  }),
  output: AwardCategory,
});

export const awardCategoriesDelete = defineContract({
  name: "awardCategories.delete",
  summary:
    "Delete an award category. Its awards stay, without a category (listed last). Requires " +
    "admin.awards.",
  kind: "write",
  input: z.object({ categoryId: Id }),
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
    "XP descending. Requires site.view and being able to view the member's profile (not found " +
    "otherwise).",
  kind: "read",
  input: z.object({ userId: Id }),
  output: z.object({ xp: z.number().int().nonnegative(), items: z.array(HeldAward) }),
});

export const awardsMemberGrants = defineContract({
  name: "awards.memberGrants",
  summary:
    "The grants a member currently holds, one per grant, newest first. Requires being able to " +
    "view the member's profile (not found otherwise), and site.view.",
  kind: "read",
  input: z.object({ userId: Id, ...pageInput }),
  output: Page(MemberAward),
});
