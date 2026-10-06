/** Boolean criteria use 1 when the property must hold and 0 when it must not hold. */
export const criteria = [
  { id: "post_count", kind: "atLeast", unit: "count" },
  { id: "days_registered", kind: "atLeast", unit: "days" },
  { id: "reaction_score", kind: "atLeast", unit: "points" },
  { id: "email_verified", kind: "boolean", unit: "boolean" },
  { id: "has_avatar", kind: "boolean", unit: "boolean" },
  { id: "active_within_days", kind: "atMost", unit: "days" },
  { id: "inactive_days", kind: "atLeast", unit: "days" },
  { id: "warning_points_below", kind: "below", unit: "points" },
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
      default:
        return false;
    }
  });
}
