import type { CriteriaRule, CriterionDefinition } from "@sermo/core/contracts";
import type * as z from "zod";

export type Rule = z.output<typeof CriteriaRule>;
export type Condition = Rule["conditions"][number];
type Definition = z.output<typeof CriterionDefinition>;

// What the rule builder needs to know about a criterion: the backend's own listing, trimmed.
export type Criterion = Pick<
  Definition,
  | "id"
  | "title"
  | "help"
  | "kind"
  | "unit"
  | "cost"
  | "idKind"
  | "window"
  | "modes"
  | "measured"
>;
export type IdKind = NonNullable<Criterion["idKind"]>;
export type Mode = Criterion["modes"][number];

// Where a rule is edited: what the place allows and what an empty rule means there. A place that
// is only checked while a request is served takes the `cheap` criteria alone (the backend refuses
// the others).
export const PLACES = {
  promotion: { cheapOnly: false, noMeasured: false, empty: "required" },
  award: { cheapOnly: false, noMeasured: false, empty: "manual" },
  notice: { cheapOnly: true, noMeasured: false, empty: "everyone" },
  shopCategory: { cheapOnly: true, noMeasured: false, empty: "everyone" },
  shopItem: { cheapOnly: true, noMeasured: false, empty: "everyone" },
  // Decided on every reaction and for every picker: no criterion that measures the member's
  // history either (the backend refuses them).
  reactionType: { cheapOnly: true, noMeasured: true, empty: "everyone" },
  postLinks: { cheapOnly: true, noMeasured: false, empty: "everyone" },
  postApproval: { cheapOnly: true, noMeasured: false, empty: "everyone" },
  // Decided when a member saves a signature.
  signature: { cheapOnly: true, noMeasured: false, empty: "everyone" },
  // Decided whenever the standings are read and when a month is decided again: cheap criteria
  // only, and a rule with no condition leaves nobody out.
  standing: { cheapOnly: true, noMeasured: false, empty: "nobody" },
  // Decided on every home page view of a visitor who chose no tab.
  homeTab: { cheapOnly: true, noMeasured: false, empty: "everyone" },
  // Evaluated while the preview request is served, for the members of a batch update: the cheap
  // criteria alone (the backend refuses the others), and a rule with no condition names nobody.
  memberBatch: { cheapOnly: true, noMeasured: false, empty: "selection" },
} as const;
export type Place = keyof typeof PLACES;

// What a condition can name, when the choices exist: a criterion that needs a group, a shop item
// and so on cannot be added when there is none to choose. Members and threads are searched, so
// they are always there to choose.
export type Available = {
  groups: boolean;
  items: boolean;
  awards: boolean;
  shopCategories: boolean;
  creditRules: boolean;
  reactionTypes: boolean;
};

// What a criterion takes in a condition, from the backend's definition: a number (everything but a
// bare list), a list of ids, a window of days, and the modes the list may be read in.
export function takes(criterion: Criterion) {
  return {
    value: !["groups", "members", "ids"].includes(criterion.kind),
    ids: criterion.idKind,
    window: criterion.window,
    modes: criterion.modes,
  };
}

const choosable = (criterion: Criterion, available: Available) => {
  if (criterion.kind === "item") return available.items;
  switch (criterion.idKind) {
    case "groups":
      return available.groups;
    case "shopItems":
      return available.items;
    case "awards":
      return available.awards;
    case "shopCategories":
      return available.shopCategories;
    case "creditRules":
      return available.creditRules;
    case "reactionTypes":
      return available.reactionTypes;
    default:
      return true;
  }
};

// The criteria a rule may gain in a place, in the order the backend lists them.
export function offeredCriteria(
  criteria: readonly Criterion[],
  place: Place,
  available: Available,
) {
  return criteria.filter(
    (criterion) =>
      (!PLACES[place].cheapOnly || criterion.cost === "cheap") &&
      (!PLACES[place].noMeasured || !criterion.measured) &&
      choosable(criterion, available),
  );
}

// A condition the builder draws a control for: its criterion is known and offered, and it has
// only what that criterion takes (a number, a list, a window, a mode it lists). Any other is shown
// as it is and saved back unchanged.
export function controlFor(
  condition: Condition,
  offered: readonly Criterion[],
): Criterion | null {
  const criterion = offered.find((entry) => entry.id === condition.criterion);
  if (!criterion) return null;
  const accepts = takes(criterion);
  if (condition.value !== undefined && !accepts.value) return null;
  if (condition.ids !== undefined && accepts.ids === null) return null;
  if (condition.days !== undefined && !accepts.window) return null;
  if (condition.mode !== undefined && !accepts.modes.includes(condition.mode))
    return null;
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

// A new condition starts empty, except a yes/no one, which starts as "must hold", and a list that
// can be read in modes, which starts in the first one (the one the backend assumes).
export function addCondition(draft: Draft, criterion: Criterion): Draft {
  const condition: Condition = { criterion: criterion.id };
  if (criterion.kind === "boolean") condition.value = 1;
  if (criterion.modes[0]) condition.mode = criterion.modes[0];
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

// What of a condition can change. A field named here is replaced (undefined, and no ids, take it
// out); one left out stays as it was.
export type Change = {
  value?: number | undefined;
  ids?: number[] | undefined;
  days?: number | undefined;
  mode?: Mode | undefined;
};

// A condition with the named fields replaced.
export function changeCondition(
  draft: Draft,
  key: number,
  change: Change,
): Draft {
  return {
    ...draft,
    entries: draft.entries.map((entry) => {
      if (entry.key !== key) return entry;
      const condition: Condition = { ...entry.condition };
      if ("value" in change) delete condition.value;
      if ("ids" in change) delete condition.ids;
      if ("days" in change) delete condition.days;
      if ("mode" in change) delete condition.mode;
      if (change.value !== undefined) condition.value = change.value;
      if (change.ids !== undefined && change.ids.length > 0)
        condition.ids = change.ids;
      if (change.days !== undefined) condition.days = change.days;
      if (change.mode !== undefined) condition.mode = change.mode;
      return { key, condition };
    }),
  };
}

// The limits of a rule, from the shared schema (`MAX_*` in the contract); a client component
// takes them as a prop because it must not import the contracts.
export type RuleLimits = {
  conditions: number;
  value: number;
  ids: number;
  days: number;
};

// The number typed in a field, or undefined for anything that is not a whole number up to `max`.
export function numberOf(raw: string, max: number) {
  const value = /^\d{1,10}$/.test(raw.trim()) ? Number(raw.trim()) : undefined;
  return value !== undefined && value <= max ? value : undefined;
}

// The rule with no conditions.
export const everyone = (): Rule => ({ match: "all", conditions: [] });
