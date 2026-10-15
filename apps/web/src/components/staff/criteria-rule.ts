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

// A form draws one switch per criterion: the first condition of each drawn criterion that takes a
// number (the one `valueOf` reads). Every other condition travels with the form and is saved back
// as it was: those of criteria it does not draw, a second condition of a drawn criterion, and any
// that is not a plain number condition. So editing a rule never drops or changes one.
export function undrawn(
  rule: Rule | undefined,
  definitions: readonly { id: string; kind?: CriterionKind }[],
) {
  const ids = new Set(
    definitions.filter(isDrawn).map((definition) => definition.id),
  );
  const seen = new Set<string>();
  return (
    rule?.conditions.filter((entry) => {
      if (!ids.has(entry.criterion) || !isDrawnCondition(entry)) return true;
      if (seen.has(entry.criterion)) return true;
      seen.add(entry.criterion);
      return false;
    }) ?? []
  );
}

const isDrawnCondition = (entry: Rule["conditions"][number]) =>
  entry.value !== undefined && entry.ids === undefined;

// The value each drawn criterion shows: that of its first plain number condition.
export function drawnValues(rule: Rule | undefined) {
  const values = new Map<string, number>();
  for (const entry of rule?.conditions ?? [])
    if (isDrawnCondition(entry) && !values.has(entry.criterion))
      values.set(entry.criterion, entry.value as number);
  return values;
}
