import type { CriteriaRule, CriterionDefinition } from "@sermo/core/contracts";
import type * as z from "zod";

export type Rule = z.output<typeof CriteriaRule>;
type Definition = z.output<typeof CriterionDefinition>;
export type CriterionKind = Definition["kind"];
type Listed = "groups" | "members";
export type DrawnDefinition = Definition & {
  kind: Exclude<Definition["kind"], Listed>;
  unit: Exclude<Definition["unit"], Listed>;
};

// The staff forms draw the criteria that take a number. Those that take a list of groups or
// members are left to the rule builder.
export const isDrawn = (definition: { kind?: CriterionKind }) =>
  definition.kind !== "groups" && definition.kind !== "members";

export const drawn = (definitions: readonly Definition[]) =>
  definitions.filter((definition): definition is DrawnDefinition =>
    isDrawn(definition),
  );

// The conditions of a rule that the forms do not draw. They travel with the form and are saved
// back as they were, so editing a rule never drops them.
export function undrawn(
  rule: Rule | undefined,
  definitions: readonly { id: string; kind?: CriterionKind }[],
) {
  const ids = new Set(
    definitions.filter(isDrawn).map((definition) => definition.id),
  );
  return rule?.conditions.filter((entry) => !ids.has(entry.criterion)) ?? [];
}
