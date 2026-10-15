import type { Criterion } from "@/components/staff/criteria-rule";

type Kind = Criterion["kind"];
type Unit = Criterion["unit"];

const entry = (
  id: string,
  kind: Kind,
  unit: Unit,
  cost: Criterion["cost"] = "cheap",
): Criterion => ({
  id,
  kind,
  unit,
  cost,
  title: `Title of ${id}`,
  help: `Help for ${id}`,
});

// The backend's registry as `criteria.list` gives it: every criterion with its kind, unit and
// cost class (`warning_points_below` is the only one that is not cheap).
export const CRITERIA: Criterion[] = [
  entry("post_count", "atLeast", "count"),
  entry("days_registered", "atLeast", "days"),
  entry("reaction_score", "atLeast", "points"),
  entry("email_verified", "boolean", "boolean"),
  entry("has_avatar", "boolean", "boolean"),
  entry("active_within_days", "atMost", "days"),
  entry("inactive_days", "atLeast", "days"),
  entry("warning_points_below", "below", "points", "background"),
  entry("credits_at_least", "atLeast", "count"),
  entry("credits_at_most", "atMost", "count"),
  entry("purchased_item", "item", "item"),
  entry("purchases_at_least", "atLeast", "count"),
  entry("is_guest", "boolean", "boolean"),
  entry("in_group", "groups", "groups"),
  entry("not_in_group", "groups", "groups"),
  entry("is_member", "members", "members"),
];

// The same list as the backend sends it, with the phrase keys the web ignores.
export const CRITERIA_BODY = CRITERIA.map((criterion) => ({
  ...criterion,
  label: `criterion.${criterion.id}`,
  description: `criterion.${criterion.id}.description`,
}));
