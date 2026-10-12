import type { Ctx } from "../context";
import { prepared } from "../context";

/**
 * Conditions on a member, shared by promotions and automatic awards. Boolean criteria use 1 when
 * the property must hold and 0 when it must not hold; `item` criteria take a shop item id.
 */
export const criteria = [
  { id: "post_count", kind: "atLeast", unit: "count" },
  { id: "days_registered", kind: "atLeast", unit: "days" },
  { id: "reaction_score", kind: "atLeast", unit: "points" },
  { id: "email_verified", kind: "boolean", unit: "boolean" },
  { id: "has_avatar", kind: "boolean", unit: "boolean" },
  { id: "active_within_days", kind: "atMost", unit: "days" },
  { id: "inactive_days", kind: "atLeast", unit: "days" },
  { id: "warning_points_below", kind: "below", unit: "points" },
  { id: "credits_at_least", kind: "atLeast", unit: "count" },
  { id: "credits_at_most", kind: "atMost", unit: "count" },
  { id: "purchased_item", kind: "item", unit: "item" },
  { id: "purchases_at_least", kind: "atLeast", unit: "count" },
] as const;

export type Criterion = { criterion: string; value: number };
export const criterionIds = new Set<string>(criteria.map((item) => item.id));
export const criterionDefinitions = criteria.map((item) => ({
  ...item,
  label: `promotion.criterion.${item.id}`,
  description: `promotion.criterion.${item.id}.description`,
}));

export interface MemberFacts {
  post_count: number;
  created_at: number;
  reaction_score: number;
  email_verified: number;
  avatar_file_id: number | null;
  last_activity_at: number | null;
  warning_points: number;
  credits: number;
  shop_purchase_count: number;
  /** Filled by `attachPurchasedItems`; absent means none of the items asked about. */
  purchased_item_ids?: ReadonlySet<number>;
}

/** Columns of `users` (aliased `u`) that criteria read, to select with the member row. */
export const CRITERIA_USER_COLUMNS =
  "u.post_count, u.created_at, u.reaction_score, u.avatar_file_id, u.last_activity_at, " +
  "u.credits, u.shop_purchase_count";

/**
 * Loads which of the shop items named by `purchased_item` conditions each member has bought, in
 * one indexed query, and stores them on the members. Does nothing when no condition asks.
 */
export function attachPurchasedItems(
  ctx: Ctx,
  members: (MemberFacts & { id: number })[],
  conditionLists: Iterable<Criterion[]>,
): void {
  const itemIds = new Set<number>();
  for (const conditions of conditionLists)
    for (const condition of conditions)
      if (condition.criterion === "purchased_item") itemIds.add(condition.value);
  if (itemIds.size === 0 || members.length === 0) return;
  const rows = prepared(ctx, "shared.criteriaPurchasedItems", () =>
    ctx.sqlite.prepare<{ buyer_id: number; item_id: number }, [string, string]>(
      "SELECT DISTINCT p.buyer_id, p.item_id FROM json_each(?1) m, json_each(?2) i " +
        "JOIN shop_purchases p ON p.buyer_id = m.value AND p.item_id = i.value",
    ),
  ).all(JSON.stringify(members.map((member) => member.id)), JSON.stringify([...itemIds]));
  const byMember = new Map<number, Set<number>>();
  for (const row of rows) {
    const set = byMember.get(row.buyer_id) ?? new Set<number>();
    set.add(row.item_id);
    byMember.set(row.buyer_id, set);
  }
  for (const member of members) {
    const set = byMember.get(member.id);
    if (set) member.purchased_item_ids = set;
  }
}

const DAY = 86_400_000;
export function eligible(facts: MemberFacts, conditions: Criterion[], now: number): boolean {
  return conditions.every(({ criterion, value }) => {
    switch (criterion) {
      case "post_count":
        return facts.post_count >= value;
      case "days_registered":
        return now - facts.created_at >= value * DAY;
      case "reaction_score":
        return facts.reaction_score >= value;
      case "email_verified":
        return Number(facts.email_verified !== 0) === value;
      case "has_avatar":
        return Number(facts.avatar_file_id !== null) === value;
      case "active_within_days":
        return facts.last_activity_at !== null && now - facts.last_activity_at <= value * DAY;
      case "inactive_days":
        return facts.last_activity_at === null || now - facts.last_activity_at >= value * DAY;
      case "warning_points_below":
        return facts.warning_points < value;
      case "credits_at_least":
        return facts.credits >= value;
      case "credits_at_most":
        return facts.credits <= value;
      case "purchased_item":
        return facts.purchased_item_ids?.has(value) ?? false;
      case "purchases_at_least":
        return facts.shop_purchase_count >= value;
      default:
        return false;
    }
  });
}
