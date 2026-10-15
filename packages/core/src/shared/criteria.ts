import type * as z from "zod";
import { type Actor, actorUserId } from "../actor";
import type { Ctx } from "../context";
import { prepared } from "../context";
import type { CriteriaCondition, CriteriaRule } from "../contracts/criteria";
import { ValidationError } from "../errors";

/**
 * The one engine that answers "who does this apply to". A rule is `{ match, conditions }`; a
 * condition names a criterion of the registry below plus what it needs (`value` or `ids`).
 * `evaluate` is the only place a rule is decided; consumers store rules, load facts with
 * `loadFacts` (or `actorFacts` for the member making a request) and call it.
 *
 * Every criterion has a cost class. `cheap` ones read the member's own row or one indexed lookup
 * and may be checked while a request is served; `background` ones are heavier and only run where
 * the check is a background job (promotions, awards). A consumer states which it allows and
 * refuses the rest with `assertRule`.
 */
export type Rule = z.infer<typeof CriteriaRule>;
export type Condition = z.infer<typeof CriteriaCondition>;
export type CostClass = "cheap" | "background";

/** The rule that matches everyone. */
export const everyone = (): Rule => ({ match: "all", conditions: [] });

/** What a member's facts are loaded from: one query per source, only when a condition asks. */
type Source = "none" | "member" | "warnings" | "purchases" | "groups";

/** Everything the registry's criteria read about one member (or a guest). */
export interface Facts {
  /** Null for a guest, who has no row, groups or history. */
  memberId: number | null;
  /** Epoch ms the facts are judged at. */
  now: number;
  postCount: number;
  createdAt: number;
  reactionScore: number;
  emailVerified: boolean;
  hasAvatar: boolean;
  lastActivityAt: number | null;
  credits: number;
  purchaseCount: number;
  /** Unexpired warning points. */
  warningPoints: number;
  /** Of the shop items some condition asks about, the ones the member bought. */
  purchasedItemIds: ReadonlySet<number>;
  /** Every group the member holds: primary, assigned by hand, granted by a promotion or bought. */
  groupIds: ReadonlySet<number>;
}

const DAY = 86_400_000;

interface Spec {
  id: string;
  kind: "atLeast" | "atMost" | "below" | "boolean" | "item" | "groups" | "members";
  unit: "count" | "days" | "points" | "boolean" | "item" | "groups" | "members";
  /** Which of `value` (a number) or `ids` (a list) the condition carries. */
  input: "value" | "ids";
  cost: CostClass;
  source: Source;
  /** Whether a guest can satisfy it; every other criterion is false for a guest. */
  guests: boolean;
  holds(facts: Facts, condition: Condition): boolean;
}

function withValue(
  id: string,
  kind: Spec["kind"],
  unit: Spec["unit"],
  source: Source,
  test: (facts: Facts, value: number) => boolean,
  cost: CostClass = "cheap",
  guests = false,
): Spec {
  return {
    id,
    kind,
    unit,
    input: "value",
    cost,
    source,
    guests,
    holds: (facts, condition) => condition.value !== undefined && test(facts, condition.value),
  };
}
function withIds(
  id: string,
  kind: Spec["kind"],
  unit: Spec["unit"],
  source: Source,
  test: (facts: Facts, ids: readonly number[]) => boolean,
  guests = false,
): Spec {
  return {
    id,
    kind,
    unit,
    input: "ids",
    cost: "cheap",
    source,
    guests,
    holds: (facts, condition) => condition.ids !== undefined && test(facts, condition.ids),
  };
}
const yes = (holds: boolean, value: number) => Number(holds) === value;

/**
 * The registry. Boolean criteria take 1 when the property must hold and 0 when it must not;
 * `purchased_item` takes a shop item id. A new criterion is one entry here (and its phrases).
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
  withIds(
    "in_group",
    "groups",
    "groups",
    "groups",
    (f, ids) => ids.some((id) => f.groupIds.has(id)),
    true,
  ),
  withIds(
    "not_in_group",
    "groups",
    "groups",
    "groups",
    (f, ids) => !ids.some((id) => f.groupIds.has(id)),
    true,
  ),
  withIds(
    "is_member",
    "members",
    "members",
    "none",
    (f, ids) => f.memberId !== null && ids.includes(f.memberId),
  ),
];
const byId = new Map(specs.map((spec) => [spec.id, spec]));

export const criterionDefinitions = specs.map((spec) => ({
  id: spec.id,
  label: `criterion.${spec.id}`,
  description: `criterion.${spec.id}.description`,
  kind: spec.kind,
  unit: spec.unit,
  cost: spec.cost,
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

/** The groups a rule reads (`in_group`, `not_in_group`), for consumers that must not depend on them. */
export function groupsReadBy(rule: Rule): number[] {
  return rule.conditions.flatMap((condition) =>
    byId.get(condition.criterion)?.kind === "groups" ? (condition.ids ?? []) : [],
  );
}

export const parseRule = (json: string): Rule => JSON.parse(json) as Rule;

/**
 * Refuses a rule a consumer may not store: an unknown criterion, a condition that lacks (or has
 * too much of) what its criterion takes, a group that does not exist, or, when `allowed` is
 * `cheap`, a `background` criterion. `background` allows every criterion.
 */
export function assertRule(ctx: Ctx, rule: Rule, allowed: CostClass): void {
  const groups = new Set<number>();
  for (const condition of rule.conditions) {
    const spec = byId.get(condition.criterion);
    if (!spec) throw new ValidationError(`Unknown criterion: ${condition.criterion}`);
    if (allowed === "cheap" && spec.cost === "background")
      throw new ValidationError(
        `The criterion ${spec.id} is too heavy to check while a request is served.`,
      );
    if (spec.input === "value") {
      if (condition.value === undefined || condition.ids !== undefined)
        throw new ValidationError(`The criterion ${spec.id} takes a value.`);
      if (spec.kind === "boolean" && condition.value > 1)
        throw new ValidationError("Boolean criterion must be 0 or 1.");
    } else {
      if (condition.ids === undefined || condition.value !== undefined)
        throw new ValidationError(`The criterion ${spec.id} takes a list of ids.`);
      if (spec.kind === "groups") for (const id of condition.ids) groups.add(id);
    }
  }
  if (groups.size === 0) return;
  const known = new Set(
    prepared(ctx, "shared.criteriaGroups", () =>
      ctx.sqlite.prepare<{ id: number }, [string]>(
        "SELECT id FROM groups WHERE id IN (SELECT value FROM json_each(?1))",
      ),
    )
      .all(JSON.stringify([...groups]))
      .map((row) => row.id),
  );
  const missing = [...groups].filter((id) => !known.has(id));
  if (missing.length > 0) throw new ValidationError(`Unknown group: ${missing.join(", ")}.`);
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
};

/**
 * The facts of a page of members for the given rules: one query per kind of fact, and only for
 * the kinds some condition reads. Nothing is queried per member.
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
  for (const rule of rules)
    for (const condition of rule.conditions) {
      const spec = byId.get(condition.criterion);
      if (!spec) continue;
      sources.add(spec.source);
      if (spec.id === "purchased_item" && condition.value !== undefined)
        itemIds.add(condition.value);
    }
  const ids = JSON.stringify([...facts.keys()]);
  const set = (id: number, change: Partial<Facts>) => Object.assign(facts.get(id)!, change);
  if (sources.has("member"))
    for (const row of prepared(ctx, "shared.criteriaMembers", () =>
      ctx.sqlite.prepare<MemberRow, [string]>(
        "SELECT u.id, u.post_count, u.created_at, u.reaction_score, u.avatar_file_id, u.last_activity_at, u.credits, u.shop_purchase_count, a.email_verified FROM users u JOIN auth_user a ON a.id = u.id WHERE u.id IN (SELECT value FROM json_each(?1))",
      ),
    ).all(ids))
      set(row.id, {
        postCount: row.post_count,
        createdAt: row.created_at,
        reactionScore: row.reaction_score,
        emailVerified: row.email_verified !== 0,
        hasAvatar: row.avatar_file_id !== null,
        lastActivityAt: row.last_activity_at,
        credits: row.credits,
        purchaseCount: row.shop_purchase_count,
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
  return facts;
}

/** The facts of whoever makes a request: a guest's, or the signed-in member's loaded for `rules`. */
export function actorFacts(ctx: Ctx, actor: Actor, rules: Iterable<Rule>): Facts {
  const userId = actorUserId(actor);
  if (userId === null) return guestFacts(ctx);
  return loadFacts(ctx, [userId], rules).get(userId)!;
}
