import type { Rule } from "@/components/staff/criteria-rule";

export const AUDIENCES = ["everyone", "guests", "members", "group"] as const;
export type Audience = (typeof AUDIENCES)[number] | "custom";

// What the notice form offers is four simple audiences; each is one rule. A rule that is none of
// them (made through the API) is shown as `custom` and saved back as it was.
export function audienceOf(rule: Rule): {
  audience: Audience;
  groupId: number | null;
} {
  const [only, ...more] = rule.conditions;
  if (!only) return { audience: "everyone", groupId: null };
  if (
    more.length === 0 &&
    only.criterion === "is_guest" &&
    only.ids === undefined
  ) {
    if (only.value === 1) return { audience: "guests", groupId: null };
    if (only.value === 0) return { audience: "members", groupId: null };
  }
  if (
    more.length === 0 &&
    only.criterion === "in_group" &&
    only.value === undefined &&
    only.ids?.length === 1
  )
    return { audience: "group", groupId: only.ids[0] ?? null };
  return { audience: "custom", groupId: null };
}

export function ruleOfAudience(
  audience: (typeof AUDIENCES)[number],
  groupId: number | null,
): Rule {
  const conditions: Rule["conditions"] = [];
  if (audience === "guests")
    conditions.push({ criterion: "is_guest", value: 1 });
  if (audience === "members")
    conditions.push({ criterion: "is_guest", value: 0 });
  if (audience === "group" && groupId !== null)
    conditions.push({ criterion: "in_group", ids: [groupId] });
  return { match: "all", conditions };
}
