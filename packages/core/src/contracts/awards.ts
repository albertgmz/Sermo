import * as z from "zod";
import { AWARD_TIERS } from "../db/schema";
import { defineContract } from "../operation";
import { ActorPassword, Empty, Id, Ok, Page, pageInput, Timestamp, UserSummary } from "./common";
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
     * An award the rule granted is not taken back when it stops holding, except by the
     * administrator's run of awards.revokeUnqualified, and it is not granted again by the rule
     * after a grant is revoked by hand (a grant that run takes back is granted again if the
     * member comes to meet the rule). Only shown with admin.awards, empty otherwise.
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

/**
 * The administrator's run that takes automatic grants back from members who no longer meet the
 * rule of the award: a count first, then the revocation.
 */
export const AwardRevokeRun = z
  .object({
    /** Idle: nothing was run yet. Failed: stopped by an error; starting the same run again resumes it. */
    state: z.enum(["idle", "running", "failed", "done"]),
    /** Count only reads and writes nothing; revoke takes the grants back. Null when idle. */
    mode: z.enum(["count", "revoke"]).nullable(),
    startedAt: Timestamp.nullable(),
    finishedAt: Timestamp.nullable(),
    /** How far through the members the run is, from 0 to 1. */
    progress: z.number().min(0).max(1),
    /** Members with automatic grants looked at so far. */
    members: z.number().int().nonnegative(),
    /** Of them, the members who lose (count) or lost (revoke) at least one grant. */
    affectedMembers: z.number().int().nonnegative(),
    /** Grants that would be taken back (count) or were (revoke). */
    grants: z.number().int().nonnegative(),
    /** XP and credits those grants gave. */
    xp: z.number().int().nonnegative(),
    credits: z.number().int().nonnegative(),
    /** The grants by award, most first. */
    awards: z.array(
      z.object({ awardId: Id, name: z.string(), grants: z.number().int().positive() }),
    ),
    error: z.string().nullable(),
  })
  .meta({ id: "AwardRevokeRun" });

export const awardsRevokeUnqualified = defineContract({
  name: "awards.revokeUnqualified",
  summary:
    "Start a background run over every member holding automatic grants (granted by a rule, " +
    "never by hand) of active awards with conditions. With apply false it only counts the " +
    "grants whose rule the member no longer meets (awards.revokeStatus reports it). With apply " +
    "true it revokes them like awards.revoke: takes back the XP and the credits each gave " +
    "(balances may go below zero), judging the member's other awards again with what is left " +
    "until none more falls; members are not notified. Grants made by hand are never touched. " +
    "A grant it revokes is granted again if the member later meets the rule. It runs in small " +
    "chunks, only when called (never at deploy or from the sweep), and a run that stopped on " +
    "an error resumes from where it stopped when called again with the same apply. Returns " +
    "queued false when a run is under way. Requires admin.awards.",
  kind: "write",
  input: z.object({ apply: z.boolean() }),
  output: z.object({ queued: z.boolean() }),
});

export const awardsRevokeStatus = defineContract({
  name: "awards.revokeStatus",
  summary:
    "The latest run of awards.revokeUnqualified: where it stands, how many grants it counted " +
    "or took back, and by award. Requires admin.awards.",
  kind: "read",
  input: Empty,
  output: AwardRevokeRun,
});

/**
 * The administrator's run that sets every member's XP and award counters to what their grants add
 * up to and judges every automatic award again; with `dryRun` the figures a real run would give.
 */
export const AwardRebuildRun = z
  .object({
    /** Idle: nothing was run yet. Failed or stopped: starting the same kind of run again resumes it. */
    state: z.enum(["idle", "running", "failed", "stopped", "done"]),
    /** True: a preview. Everything was undone chunk by chunk and the figures are what a real run would do. */
    dryRun: z.boolean(),
    startedAt: Timestamp.nullable(),
    finishedAt: Timestamp.nullable(),
    /** How far through the members the run is, from 0 to 1. */
    progress: z.number().min(0).max(1),
    /** Members looked at so far. */
    members: z.number().int().nonnegative(),
    /** Members whose stored XP or award count differed from the grants they hold. */
    xpCorrected: z.number().int().nonnegative(),
    /** Members whose XP at the end differs from what they had. */
    xpChanged: z.number().int().nonnegative(),
    /** Members whose level goes up, and whose goes down. */
    levelsUp: z.number().int().nonnegative(),
    levelsDown: z.number().int().nonnegative(),
    /** Per-member award counters that were repaired. */
    totalsCorrected: z.number().int().nonnegative(),
    /** Automatic grants made, and taken back. */
    granted: z.number().int().nonnegative(),
    takenBack: z.number().int().nonnegative(),
    /** Credits paid by the grants, and taken back with the revoked ones. */
    creditsPaid: z.number().int().nonnegative(),
    creditsRemoved: z.number().int().nonnegative(),
    /** Members whose balance was not below zero and is at the end. */
    newlyNegative: z.number().int().nonnegative(),
    /** The twenty awards most affected, most first. */
    awards: z.array(
      z.object({
        awardId: Id,
        name: z.string(),
        granted: z.number().int().nonnegative(),
        takenBack: z.number().int().nonnegative(),
      }),
    ),
    error: z.string().nullable(),
  })
  .meta({ id: "AwardRebuildRun" });

export const awardsRebuild = defineContract({
  name: "awards.rebuild",
  summary:
    "Start a background run over every member that makes the site match the awards' rules at " +
    "this moment: it sets each member's award XP, award count and per-award counters to what the " +
    "grants they hold add up to (the level follows from the XP), takes back the automatic grants " +
    "whose rule the member no longer meets (like awards.revokeUnqualified: their XP and credits " +
    "are taken back, balances may go below zero) and grants the automatic awards the member meets " +
    "and does not hold, with their XP and credits. Grants made by hand are never touched, and a " +
    "grant revoked by hand is not given again. Members are not notified. With dryRun true it " +
    "does all this chunk by chunk and undoes each chunk, so that awards.rebuildStatus reports " +
    "what a real run would change (levels up and down, grants by award, credits, balances that " +
    "would go negative) and nothing stays changed. A second run changes nothing unless rules " +
    "depend on time, credits or XP, or credit rules pay for awards. It runs in small chunks, " +
    "only when called; a run that stopped (on an error, or by awards.rebuildStop) resumes from " +
    "where it stopped when called again with the same dryRun. Returns queued false when a run is " +
    "under way. Requires admin.awards. A real run needs `actorPassword`, the acting " +
    "administrator's own password: a browser session must send it, and an API key or token " +
    "cannot start it; a dry run needs none.",
  kind: "write",
  input: z.object({
    dryRun: z.boolean().default(false),
    actorPassword: ActorPassword.optional(),
  }),
  output: z.object({ queued: z.boolean() }),
});

export const awardsRebuildStatus = defineContract({
  name: "awards.rebuildStatus",
  summary:
    "The latest run of awards.rebuild, real or dry: where it stands and what it changed (or would " +
    "change) so far. Requires admin.awards.",
  kind: "read",
  input: Empty,
  output: AwardRebuildRun,
});

export const awardsRebuildStop = defineContract({
  name: "awards.rebuildStop",
  summary:
    "Ask the rebuild under way to end before its next chunk, leaving what is done as it is. " +
    "Calling awards.rebuild again resumes it. Returns stopped false when none is under way. " +
    "Requires admin.awards.",
  kind: "write",
  input: Empty,
  output: z.object({ stopped: z.boolean() }),
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
