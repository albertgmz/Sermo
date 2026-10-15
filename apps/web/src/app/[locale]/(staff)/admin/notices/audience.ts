import type { Rule } from "@/components/staff/criteria-rule";

export type Audience = "everyone" | "guests" | "members" | "group" | "custom";

// The notice list names four simple audiences, each one rule. Any other rule is `custom`.
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
