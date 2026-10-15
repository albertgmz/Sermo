import type { CriteriaRule, CriterionDefinition } from "@sermo/core/contracts";
import type * as z from "zod";

export type Rule = z.output<typeof CriteriaRule>;
export type Condition = Rule["conditions"][number];
type Definition = z.output<typeof CriterionDefinition>;

// What the rule builder needs to know about a criterion: the backend's own listing, trimmed.
export type Criterion = Pick<
  Definition,
  "id" | "title" | "help" | "kind" | "unit" | "cost"
>;

// Where a rule is edited: what the place allows and what an empty rule means there. A place that
// is only checked while a request is served takes the `cheap` criteria alone (the backend refuses
// the others).
export const PLACES = {
  promotion: { cheapOnly: false, empty: "required" },
  award: { cheapOnly: false, empty: "manual" },
  notice: { cheapOnly: true, empty: "everyone" },
  shopCategory: { cheapOnly: true, empty: "everyone" },
  shopItem: { cheapOnly: true, empty: "everyone" },
} as const;
export type Place = keyof typeof PLACES;

// What a condition can name, when the choices exist: a criterion that needs a group or a shop item
// cannot be added when there is none to choose.
export type Available = { groups: boolean; items: boolean };

// The criteria a rule may gain in a place, in the order the backend lists them.
export function offeredCriteria(
  criteria: readonly Criterion[],
  place: Place,
  available: Available,
) {
  return criteria.filter(
    (criterion) =>
      (!PLACES[place].cheapOnly || criterion.cost === "cheap") &&
      !(criterion.kind === "groups" && !available.groups) &&
      !(criterion.kind === "item" && !available.items),
  );
}

// A condition the builder draws a control for: its criterion is known and offered, and it has the
// kind of input the criterion takes. Any other is shown as it is and saved back unchanged.
export function controlFor(
  condition: Condition,
  offered: readonly Criterion[],
): Criterion | null {
  const criterion = offered.find((entry) => entry.id === condition.criterion);
  if (!criterion) return null;
  const takesIds = criterion.kind === "groups" || criterion.kind === "members";
  if (takesIds) return condition.value === undefined ? criterion : null;
  if (condition.ids !== undefined) return null;
  // A yes/no condition holds 1 or 0 (or is new and has none yet); the control shows nothing else.
  if (
    criterion.kind === "boolean" &&
    ![undefined, 0, 1].includes(condition.value)
  )
    return null;
  return criterion;
}

// The rule being edited: the conditions in their order, each with a key of its own (two conditions
// of one criterion are two entries, never merged).
export type Draft = {
  match: Rule["match"];
  entries: { key: number; condition: Condition }[];
  next: number;
};

export function draftOf(rule: Rule): Draft {
  return {
    match: rule.match,
    entries: rule.conditions.map((condition, key) => ({ key, condition })),
    next: rule.conditions.length,
  };
}

export const ruleOfDraft = (draft: Draft): Rule => ({
  match: draft.match,
  conditions: draft.entries.map((entry) => entry.condition),
});

// A new condition starts empty, except a yes/no one, which starts as "must hold".
export function addCondition(draft: Draft, criterion: Criterion): Draft {
  const condition: Condition =
    criterion.kind === "boolean"
      ? { criterion: criterion.id, value: 1 }
      : { criterion: criterion.id };
  return {
    ...draft,
    entries: [...draft.entries, { key: draft.next, condition }],
    next: draft.next + 1,
  };
}

export const removeCondition = (draft: Draft, key: number): Draft => ({
  ...draft,
  entries: draft.entries.filter((entry) => entry.key !== key),
});

export type Change = { value?: number | undefined; ids?: number[] | undefined };

// A condition with its number or its ids replaced; undefined leaves the field out.
export function changeCondition(
  draft: Draft,
  key: number,
  input: Change,
): Draft {
  return {
    ...draft,
    entries: draft.entries.map((entry) => {
      if (entry.key !== key) return entry;
      const condition: Condition = { criterion: entry.condition.criterion };
      if (input.value !== undefined) condition.value = input.value;
      if (input.ids !== undefined && input.ids.length > 0)
        condition.ids = input.ids;
      return { key, condition };
    }),
  };
}

// The number typed in a field, or undefined for anything that is not a whole number.
export const numberOf = (raw: string) =>
  /^\d{1,10}$/.test(raw.trim()) ? Number(raw.trim()) : undefined;

// The rule with no conditions.
export const everyone = (): Rule => ({ match: "all", conditions: [] });
