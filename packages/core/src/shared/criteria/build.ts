import {
  type CostClass,
  type Facts,
  type IdKind,
  listHolds,
  type Measurer,
  type Mode,
  perIdOf,
  type Source,
  type Spec,
  scalarOf,
} from "./types";

/** What a criterion needs besides its statement: which events change its fact. */
type Refresh = Pick<Spec, "refresh">;

type Kind = Spec["kind"];
type Unit = Spec["unit"];

const noTakes = { value: false, ids: null, window: false, modes: [] } as const;

/** A criterion read from a number: a threshold, a limit, or 1/0 for a yes/no one. */
export function withValue(
  id: string,
  kind: Kind,
  unit: Unit,
  source: Source,
  test: (facts: Facts, value: number) => boolean,
  cost: CostClass = "cheap",
  guests = false,
  measure?: Measurer,
): Spec {
  return {
    id,
    kind,
    unit,
    takes: { ...noTakes, value: true },
    cost,
    source,
    guests,
    ...(measure && { measure }),
    holds: (facts, condition) => condition.value !== undefined && test(facts, condition.value),
  };
}

/** A criterion read from a list of group or member ids. */
export function withIds(
  id: string,
  kind: "groups" | "members",
  source: Source,
  test: (facts: Facts, ids: readonly number[]) => boolean,
  guests = false,
): Spec {
  return {
    id,
    kind,
    unit: kind,
    takes: { ...noTakes, ids: kind },
    cost: "cheap",
    source,
    guests,
    holds: (facts, condition) => condition.ids !== undefined && test(facts, condition.ids),
  };
}

export const yes = (holds: boolean, value: number) => Number(holds) === value;

/** A yes/no criterion on the member's own row: 1 when the property must hold, 0 when it must not. */
export const flag = (id: string, test: (facts: Facts) => boolean): Spec =>
  withValue(id, "boolean", "boolean", "member", (facts, value) => yes(test(facts), value));

/** A yes/no criterion that one indexed lookup answers (a row exists or it does not). */
export function lookup(id: string, measure: Measurer): Spec {
  const condition = { criterion: id };
  return withValue(
    id,
    "boolean",
    "boolean",
    "measure",
    (facts, value) => yes(scalarOf(facts, condition) > 0, value),
    "cheap",
    false,
    measure,
  );
}

/**
 * A count over the member's history, at least the condition's number. It reads many rows, so it
 * only runs in background checks.
 */
export function counted(
  id: string,
  measure: Measurer,
  options: { unit?: Unit; window?: boolean } & Refresh = {},
): Spec {
  return {
    ...(options.refresh && { refresh: options.refresh }),
    id,
    kind: "atLeast",
    unit: options.unit ?? "count",
    takes: { ...noTakes, value: true, window: options.window ?? false },
    cost: "background",
    source: "measure",
    guests: false,
    measure,
    holds: (facts, condition) =>
      condition.value !== undefined && scalarOf(facts, condition) >= condition.value,
  };
}

/**
 * A criterion over a list of ids, read in one of `modes` (the first is the default). With
 * `value` the list entries must reach that number, otherwise 1 (a row exists).
 */
export function listed(
  id: string,
  idKind: IdKind,
  measure: Measurer,
  options: {
    modes: readonly [Mode, ...Mode[]];
    value?: boolean;
    window?: boolean;
    cost?: CostClass;
  } & Refresh,
): Spec {
  return {
    ...(options.refresh && { refresh: options.refresh }),
    id,
    kind: options.value ? "atLeast" : "ids",
    unit: options.value ? "count" : "ids",
    takes: {
      value: options.value ?? false,
      ids: idKind,
      window: options.window ?? false,
      modes: options.modes,
    },
    cost: options.cost ?? "background",
    source: "measure",
    guests: false,
    measure,
    holds: (facts, condition) =>
      condition.ids !== undefined &&
      listHolds(perIdOf(facts, condition), condition, condition.mode ?? options.modes[0]),
  };
}

/**
 * The number of rows each member has in `table`, found through `index` (which starts with
 * `column`). The index is named so the planner never picks one on `where` and reads every row.
 */
export const countOf = (table: string, column: string, index: string, where = ""): Measurer => ({
  shape: "scalar",
  sql: `SELECT ${column} AS user_id, NULL AS id, count(*) AS n FROM ${table} INDEXED BY ${index} WHERE ${column} IN (SELECT value FROM json_each(?1))${where && ` AND ${where}`} GROUP BY ${column}`,
});
