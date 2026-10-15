import { type Actor, actorUserId } from "../actor";
import type { Ctx } from "../context";
import { prepared } from "../context";
import { ValidationError } from "../errors";
import type { DomainEvent } from "../events";
import { awardSpecs } from "./criteria/awards";
import { withIds, withValue, yes } from "./criteria/build";
import { contentSpecs } from "./criteria/content";
import { economySpecs } from "./criteria/economy";
import { engagementSpecs } from "./criteria/engagement";
import { moderationSpecs } from "./criteria/moderation";
import { profileSpecs } from "./criteria/profile";
import { referralSpecs } from "./criteria/referrals";
import {
  type Condition,
  type CostClass,
  DAY,
  type Facts,
  type IdKind,
  measureKey,
  type Rule,
  type Source,
  type Spec,
} from "./criteria/types";

/**
 * The one engine that answers "who does this apply to". A rule is `{ match, conditions }`; a
 * condition names a criterion of the registry below plus what it needs (`value`, `ids`, a window
 * of `days`, a `mode`). `evaluate` is the only place a rule is decided; consumers store rules,
 * load facts with `loadFacts` (or `actorFacts` for the member making a request) and call it.
 *
 * Every criterion has a cost class. `cheap` ones read the member's own row or answer from one
 * indexed lookup and may be checked while a request is served; `background` ones count or sum the
 * member's history and only run where the check is a background job (promotions, awards). A
 * consumer states which it allows and refuses the rest with `assertRule`. The criteria of each
 * area live in `criteria/`; the first ones, on the member's own row, are below.
 */
export type { Condition, CostClass, Facts, Rule };

/** The rule that matches everyone. */
export const everyone = (): Rule => ({ match: "all", conditions: [] });

/**
 * The registry. Boolean criteria take 1 when the property must hold and 0 when it must not;
 * `purchased_item` takes a shop item id. A new criterion is one entry here or in `criteria/` (and
 * its phrases).
 */
const specs: readonly Spec[] = [
  withValue("post_count", "atLeast", "count", "member", (f, v) => f.postCount >= v),
  withValue(
    "days_registered",
    "atLeast",
    "days",
    "member",
    (f, v) => f.now - f.createdAt >= v * DAY,
  ),
  withValue("reaction_score", "atLeast", "points", "member", (f, v) => f.reactionScore >= v),
  withValue("email_verified", "boolean", "boolean", "member", (f, v) => yes(f.emailVerified, v)),
  withValue("has_avatar", "boolean", "boolean", "member", (f, v) => yes(f.hasAvatar, v)),
  withValue(
    "active_within_days",
    "atMost",
    "days",
    "member",
    (f, v) => f.lastActivityAt !== null && f.now - f.lastActivityAt <= v * DAY,
  ),
  withValue(
    "inactive_days",
    "atLeast",
    "days",
    "member",
    (f, v) => f.lastActivityAt === null || f.now - f.lastActivityAt >= v * DAY,
  ),
  // A sum over the member's warnings: not on their row, so only for background checks.
  withValue(
    "warning_points_below",
    "below",
    "points",
    "warnings",
    (f, v) => f.warningPoints < v,
    "background",
  ),
  withValue("credits_at_least", "atLeast", "count", "member", (f, v) => f.credits >= v),
  withValue("credits_at_most", "atMost", "count", "member", (f, v) => f.credits <= v),
  withValue("purchased_item", "item", "item", "purchases", (f, v) => f.purchasedItemIds.has(v)),
  withValue("purchases_at_least", "atLeast", "count", "member", (f, v) => f.purchaseCount >= v),
  withValue(
    "is_guest",
    "boolean",
    "boolean",
    "none",
    (f, v) => yes(f.memberId === null, v),
    "cheap",
    true,
  ),
  withIds("in_group", "groups", "groups", (f, ids) => ids.some((id) => f.groupIds.has(id)), true),
  withIds(
    "not_in_group",
    "groups",
    "groups",
    (f, ids) => !ids.some((id) => f.groupIds.has(id)),
    true,
  ),
  withIds(
    "is_member",
    "members",
    "none",
    (f, ids) => f.memberId !== null && ids.includes(f.memberId),
  ),
  ...contentSpecs,
  ...economySpecs,
  ...awardSpecs,
  ...profileSpecs,
  ...moderationSpecs,
  ...engagementSpecs,
  ...referralSpecs,
];
const byId = new Map(specs.map((spec) => [spec.id, spec]));

/** The statement of every measured criterion, for tests that check their plans. */
export const criteriaMeasures = specs.flatMap((spec) =>
  spec.measure ? [{ id: spec.id, sql: spec.measure.sql }] : [],
);

export const criterionDefinitions = specs.map((spec) => ({
  id: spec.id,
  label: `criterion.${spec.id}`,
  description: `criterion.${spec.id}.description`,
  kind: spec.kind,
  unit: spec.unit,
  cost: spec.cost,
  idKind: spec.takes.ids,
  window: spec.takes.window,
  modes: [...spec.takes.modes],
  measured: spec.source === "measure",
}));

/** The only place a rule is decided. A condition that names no known criterion never holds. */
export function evaluate(rule: Rule, facts: Facts): boolean {
  if (rule.conditions.length === 0) return true;
  const holds = (condition: Condition) => {
    const spec = byId.get(condition.criterion);
    if (!spec || (facts.memberId === null && !spec.guests)) return false;
    return spec.holds(facts, condition);
  };
  return rule.match === "all" ? rule.conditions.every(holds) : rule.conditions.some(holds);
}

/** The ids of one kind that a rule reads. */
function idsReadBy(rule: Rule, kind: IdKind): number[] {
  return rule.conditions.flatMap((condition) =>
    byId.get(condition.criterion)?.takes.ids === kind ? (condition.ids ?? []) : [],
  );
}

/** The groups a rule reads (`in_group`, `not_in_group`), for consumers that must not depend on them. */
export const groupsReadBy = (rule: Rule): number[] => idsReadBy(rule, "groups");

/** The awards a rule reads (`holds_awards`), for the award that must not depend on itself. */
export const awardsReadBy = (rule: Rule): number[] => idsReadBy(rule, "awards");

export const parseRule = (json: string): Rule => JSON.parse(json) as Rule;

/** The tables whose rows an id list names, and how an unknown id is called. Members are not checked. */
const idTables: Record<IdKind, { table: string; noun: string; where?: string } | null> = {
  groups: { table: "groups", noun: "group" },
  members: null,
  // A thread merged into another keeps its row but its posts moved: it would count nothing.
  threads: { table: "threads", noun: "thread", where: "merged_into_id IS NULL" },
  awards: { table: "awards", noun: "award" },
  shopItems: { table: "shop_items", noun: "shop item" },
  shopCategories: { table: "shop_categories", noun: "shop category" },
  creditRules: { table: "credit_rules", noun: "credit rule" },
};

function takesText(spec: Spec): string {
  const { takes } = spec;
  const parts: string[] = [];
  if (takes.value) parts.push("a number");
  if (takes.ids) parts.push("a list of ids");
  if (takes.window) parts.push("an optional window of days");
  if (takes.modes.length > 0) parts.push(`an optional mode (${takes.modes.join(", ")})`);
  return parts.length > 0 ? parts.join(", ") : "nothing";
}

/**
 * Refuses a rule a consumer may not store: an unknown criterion, a condition that lacks (or has
 * too much of) what its criterion takes, an id that does not exist (groups, threads, awards, shop
 * items and categories, credit rules), or, when `allowed` is `cheap`, a `background` criterion.
 * `background` allows every criterion.
 */
export function assertRule(ctx: Ctx, rule: Rule, allowed: CostClass): void {
  const named = new Map<IdKind, Set<number>>();
  for (const condition of rule.conditions) {
    const spec = byId.get(condition.criterion);
    if (!spec) throw new ValidationError(`Unknown criterion: ${condition.criterion}`);
    if (allowed === "cheap" && spec.cost === "background")
      throw new ValidationError(
        `The criterion ${spec.id} is too heavy to check while a request is served.`,
      );
    const { takes } = spec;
    if (
      (takes.value ? condition.value === undefined : condition.value !== undefined) ||
      (takes.ids ? condition.ids === undefined : condition.ids !== undefined) ||
      (!takes.window && condition.days !== undefined) ||
      (condition.mode !== undefined && !takes.modes.includes(condition.mode))
    )
      throw new ValidationError(`The criterion ${spec.id} takes ${takesText(spec)}.`);
    if (spec.kind === "boolean" && condition.value! > 1)
      throw new ValidationError("Boolean criterion must be 0 or 1.");
    if (takes.ids && condition.ids) {
      const ids = named.get(takes.ids) ?? new Set<number>();
      for (const id of condition.ids) ids.add(id);
      named.set(takes.ids, ids);
    }
  }
  for (const [kind, ids] of named) {
    const names = idTables[kind];
    if (!names) continue;
    const known = new Set(
      prepared(ctx, `shared.criteriaIds.${kind}`, () =>
        ctx.sqlite.prepare<{ id: number }, [string]>(
          `SELECT id FROM ${names.table} WHERE id IN (SELECT value FROM json_each(?1))${names.where ? ` AND ${names.where}` : ""}`,
        ),
      )
        .all(JSON.stringify([...ids]))
        .map((row) => row.id),
    );
    const missing = [...ids].filter((id) => !known.has(id));
    if (missing.length > 0)
      throw new ValidationError(`Unknown ${names.noun}: ${missing.join(", ")}.`);
  }
}

const noFacts = (memberId: number | null, now: number): Facts => ({
  memberId,
  now,
  postCount: 0,
  createdAt: 0,
  reactionScore: 0,
  emailVerified: false,
  hasAvatar: false,
  lastActivityAt: null,
  credits: 0,
  purchaseCount: 0,
  warningPoints: 0,
  purchasedItemIds: new Set(),
  groupIds: new Set(),
  hasCover: false,
  hasNameColor: false,
  hasAccentColor: false,
  hasFrame: false,
  socialLinkCount: 0,
  profileComplete: false,
  usernameChangedAt: null,
  restrictedPosting: false,
  restrictedConversations: false,
  restrictedProfilePosts: false,
  referralCount: 0,
  wasReferred: false,
  awardCount: 0,
  awardXp: 0,
  measures: new Map(),
});

/** The facts of a guest. */
export const guestFacts = (ctx: Ctx): Facts => noFacts(null, ctx.now());

type MemberRow = {
  id: number;
  post_count: number;
  created_at: number;
  reaction_score: number;
  avatar_file_id: number | null;
  last_activity_at: number | null;
  credits: number;
  shop_purchase_count: number;
  email_verified: number;
  award_count: number;
  award_xp: number;
  has_cover: number;
  has_name_color: number;
  has_accent_color: number;
  has_frame: number;
  social_links: number;
  profile_complete: number;
  username_changed_at: number | null;
  restricted_posting: number;
  restricted_conversations: number;
  restricted_profile_posts: number;
  referral_count: number;
  was_referred: number;
};

/** The statement of the facts on the member's own row, for tests that check its plan. */
export const memberFactsSql =
  "SELECT u.id, u.post_count, u.created_at, u.reaction_score, u.avatar_file_id, u.last_activity_at, u.credits, u.shop_purchase_count, a.email_verified, u.award_count, u.award_xp, (u.cover_file_id IS NOT NULL OR u.cover_preset_id IS NOT NULL) AS has_cover, (u.name_color_id IS NOT NULL) AS has_name_color, (u.accent_color_id IS NOT NULL) AS has_accent_color, (u.frame_id IS NOT NULL) AS has_frame, ((u.social_discord != '') + (u.social_telegram != '') + (u.social_x != '')) AS social_links, (u.avatar_file_id IS NOT NULL AND u.about != '' AND u.location != '' AND u.birthday_md IS NOT NULL) AS profile_complete, u.username_changed_at, (coalesce(u.restricted_posting_until, 0) > ?2) AS restricted_posting, (coalesce(u.restricted_conversations_until, 0) > ?2) AS restricted_conversations, (coalesce(u.restricted_profile_posts_until, 0) > ?2) AS restricted_profile_posts, u.referral_count, (u.referred_by IS NOT NULL) AS was_referred FROM users u JOIN auth_user a ON a.id = u.id WHERE u.id IN (SELECT value FROM json_each(?1))";

type MeasureRow = { user_id: number; id: number | null; n: number | null };

/** The values a measure's statement is given: members, ids, window start, now, month start. */
export function measureSlots(condition: Condition, members: string, now: number, sql: string) {
  const month = new Date(now);
  const slots = [
    members,
    JSON.stringify([...new Set(condition.ids ?? [])]),
    condition.days === undefined ? 0 : now - condition.days * DAY,
    now,
    Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1),
  ];
  const used = Math.max(...[...sql.matchAll(/\?(\d)/g)].map((match) => Number(match[1])));
  return slots.slice(0, used);
}

/**
 * The facts of a page of members for the given rules: one query per kind of fact, and only for
 * the kinds some condition reads. Nothing is queried per member. A measured criterion costs one
 * query for each distinct combination of criterion, ids and window that the rules name.
 */
export function loadFacts(
  ctx: Ctx,
  memberIds: readonly number[],
  rules: Iterable<Rule>,
): Map<number, Facts> {
  const now = ctx.now();
  const facts = new Map(memberIds.map((id) => [id, noFacts(id, now)] as const));
  if (facts.size === 0) return facts;
  const sources = new Set<Source>();
  const itemIds = new Set<number>();
  const measured = new Map<string, { spec: Spec; condition: Condition }>();
  for (const rule of rules)
    for (const condition of rule.conditions) {
      const spec = byId.get(condition.criterion);
      if (!spec) continue;
      sources.add(spec.source);
      if (spec.id === "purchased_item" && condition.value !== undefined)
        itemIds.add(condition.value);
      if (spec.measure) measured.set(measureKey(condition), { spec, condition });
    }
  const ids = JSON.stringify([...facts.keys()]);
  const set = (id: number, change: Partial<Facts>) => Object.assign(facts.get(id)!, change);
  if (sources.has("member"))
    for (const row of prepared(ctx, "shared.criteriaMembers", () =>
      ctx.sqlite.prepare<MemberRow, [string, number]>(memberFactsSql),
    ).all(ids, now))
      set(row.id, {
        postCount: row.post_count,
        createdAt: row.created_at,
        reactionScore: row.reaction_score,
        emailVerified: row.email_verified !== 0,
        hasAvatar: row.avatar_file_id !== null,
        lastActivityAt: row.last_activity_at,
        credits: row.credits,
        purchaseCount: row.shop_purchase_count,
        awardCount: row.award_count,
        awardXp: row.award_xp,
        hasCover: row.has_cover !== 0,
        hasNameColor: row.has_name_color !== 0,
        hasAccentColor: row.has_accent_color !== 0,
        hasFrame: row.has_frame !== 0,
        socialLinkCount: row.social_links,
        profileComplete: row.profile_complete !== 0,
        usernameChangedAt: row.username_changed_at,
        restrictedPosting: row.restricted_posting !== 0,
        restrictedConversations: row.restricted_conversations !== 0,
        restrictedProfilePosts: row.restricted_profile_posts !== 0,
        referralCount: row.referral_count,
        wasReferred: row.was_referred !== 0,
      });
  if (sources.has("warnings"))
    for (const row of prepared(ctx, "shared.criteriaWarnings", () =>
      ctx.sqlite.prepare<{ user_id: number; points: number }, [string, number]>(
        "SELECT user_id, sum(points) AS points FROM warnings WHERE user_id IN (SELECT value FROM json_each(?1)) AND (expires_at IS NULL OR expires_at > ?2) GROUP BY user_id",
      ),
    ).all(ids, now))
      set(row.user_id, { warningPoints: row.points });
  if (sources.has("purchases") && itemIds.size > 0) {
    const bought = new Map<number, Set<number>>();
    for (const row of prepared(ctx, "shared.criteriaPurchasedItems", () =>
      ctx.sqlite.prepare<{ buyer_id: number; item_id: number }, [string, string]>(
        "SELECT m.value AS buyer_id, i.value AS item_id FROM json_each(?1) m, json_each(?2) i " +
          "WHERE EXISTS (SELECT 1 FROM shop_purchases p WHERE p.buyer_id = m.value AND p.item_id = i.value)",
      ),
    ).all(ids, JSON.stringify([...itemIds]))) {
      const items = bought.get(row.buyer_id) ?? new Set<number>();
      items.add(row.item_id);
      bought.set(row.buyer_id, items);
    }
    for (const [id, items] of bought) set(id, { purchasedItemIds: items });
  }
  if (sources.has("groups")) {
    const groups = new Map<number, Set<number>>();
    for (const row of prepared(ctx, "shared.criteriaGroupIds", () =>
      ctx.sqlite.prepare<{ user_id: number; group_id: number }, [string]>(
        "SELECT id AS user_id, group_id FROM users WHERE id IN (SELECT value FROM json_each(?1)) " +
          "UNION ALL SELECT user_id, group_id FROM user_groups WHERE user_id IN (SELECT value FROM json_each(?1)) " +
          "UNION ALL SELECT user_id, group_id FROM user_group_grants WHERE user_id IN (SELECT value FROM json_each(?1)) " +
          "UNION ALL SELECT user_id, group_id FROM shop_group_grants WHERE user_id IN (SELECT value FROM json_each(?1))",
      ),
    ).all(ids)) {
      const memberGroups = groups.get(row.user_id) ?? new Set<number>();
      memberGroups.add(row.group_id);
      groups.set(row.user_id, memberGroups);
    }
    for (const [id, memberGroups] of groups) set(id, { groupIds: memberGroups });
  }
  for (const [key, { spec, condition }] of measured) {
    const { sql, shape } = spec.measure!;
    const perId = shape === "perId";
    if (perId) for (const memberFacts of facts.values()) memberFacts.measures.set(key, new Map());
    for (const row of prepared(ctx, `shared.criteria.${spec.id}`, () =>
      ctx.sqlite.prepare<MeasureRow, (string | number)[]>(sql),
    ).all(...measureSlots(condition, ids, now, sql))) {
      const memberFacts = facts.get(row.user_id);
      if (!memberFacts || row.n === null) continue;
      if (perId) (memberFacts.measures.get(key) as Map<number, number>).set(row.id!, row.n);
      // A statement may answer in several rows for one member (one per source); they add up.
      else memberFacts.measures.set(key, Number(memberFacts.measures.get(key) ?? 0) + row.n);
    }
  }
  return facts;
}

/**
 * The members, besides the ones a consumer already follows, whose facts for the criteria of
 * `rules` this event may have changed. Each is to be checked again at once.
 */
export function membersAffected(ctx: Ctx, event: DomainEvent, rules: Iterable<Rule>): number[] {
  const refreshers = new Set<NonNullable<Spec["refresh"]>>();
  for (const rule of rules)
    for (const condition of rule.conditions) {
      const refresh = byId.get(condition.criterion)?.refresh;
      if (refresh?.on.includes(event.type)) refreshers.add(refresh);
    }
  const members = new Set<number>();
  for (const refresh of refreshers)
    for (const id of refresh.members(ctx, event))
      if (Number.isInteger(id) && id > 0) members.add(id);
  return [...members];
}

/** Whether any criterion wants this kind of event; a consumer asks before it loads its rules. */
export const isRefreshedBy = (event: DomainEvent): boolean =>
  specs.some((spec) => spec.refresh?.on.includes(event.type));

/**
 * Records an award just granted in the facts a pass of automatic awards is judging, so the
 * awards after it in the same pass see it (its credits, XP, and the award itself).
 */
export function afterAwardGrant(
  facts: Facts,
  award: { id: number; xp: number; credits: number },
): void {
  facts.credits += award.credits;
  facts.awardXp += award.xp;
  facts.awardCount += 1;
  for (const [key, measure] of facts.measures) {
    const [criterion, ids] = key.split("|");
    if (criterion !== "holds_awards" || !(measure instanceof Map)) continue;
    if (ids?.split(",").includes(String(award.id)))
      measure.set(award.id, (measure.get(award.id) ?? 0) + 1);
  }
}

/** Whether a rule holds a criterion too heavy to load on every event; the sweep decides those. */
export const needsSweep = (rule: Rule): boolean =>
  rule.conditions.some((condition) => byId.get(condition.criterion)?.sweepOnly === true);

/**
 * The criteria in a rule that are answered by a measure: one statement for each such condition on
 * top of the per-kind facts. A consumer that decides a rule on every request refuses them to keep
 * its statement count fixed.
 */
export const measuredCriteria = (rule: Rule): string[] =>
  rule.conditions.flatMap((condition) =>
    byId.get(condition.criterion)?.source === "measure" ? [condition.criterion] : [],
  );

/** The facts of whoever makes a request: a guest's, or the signed-in member's loaded for `rules`. */
export function actorFacts(ctx: Ctx, actor: Actor, rules: Iterable<Rule>): Facts {
  const userId = actorUserId(actor);
  if (userId === null) return guestFacts(ctx);
  return loadFacts(ctx, [userId], rules).get(userId)!;
}
