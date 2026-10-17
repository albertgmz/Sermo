// The state the permission matrix (permission-matrix.tsx) keeps while it is edited, and the bulk
// changes its buttons make. Plain functions, so the matrix and its tests share them.
//
// A cell is what one row's controls hold: `mode` is the select ("" not set, a yes/no state, or
// for an integer "value" / "unlimited") and `amount` the number typed for an integer with
// "value". The form posts exactly these (`modeField`, `numberField` in ./permission-entries).

import {
  cellChanged,
  cellText,
  cellValue,
  type MatrixValue,
} from "./permission-entries";

export type Cell = { mode: string; amount: string };

// What `matrix-state` needs of a permission (a `MatrixPermission` has these).
type Shown = { id: string; type: "flag" | "integer"; category: string };

// The two tabs of the matrix: moderation alone, every other category under "general".
export type MatrixTab = "general" | "moderation";
export const TABS: readonly MatrixTab[] = ["general", "moderation"];
export const tabOf = (category: string): MatrixTab =>
  category === "moderation" ? "moderation" : "general";

// What a bulk button sets every yes/no row of its tab or category to: allow, never, or "" (not
// set, so the row inherits again). "No" has no bulk button: on a forum it stays a per-row choice.
export type BulkMode = "allow" | "never" | "";

// The cell a row starts with, from the target's entry (undefined: not set).
export function initialCell(
  type: Shown["type"],
  value: MatrixValue | undefined,
): Cell {
  if (value === undefined) return { mode: "", amount: "" };
  if (type === "flag") return { mode: String(value), amount: "" };
  return value === -1
    ? { mode: "unlimited", amount: "" }
    : { mode: "value", amount: String(value) };
}

export function initialCells(
  permissions: readonly Shown[],
  entries: Readonly<Record<string, MatrixValue>>,
): Record<string, Cell> {
  return Object.fromEntries(
    permissions.map((permission) => [
      permission.id,
      initialCell(permission.type, entries[permission.id]),
    ]),
  );
}

// Whether a row now asks for something else than the entry it showed, as `matrixChanges` will
// read it once posted.
export function isChanged(
  permission: Shown,
  cell: Cell,
  entry: MatrixValue | undefined,
  allowNo: boolean,
): boolean {
  return cellChanged(
    cellValue(permission.type, cell.mode, cell.amount, allowNo),
    cellText(entry),
  );
}

// The ids of the rows that changed, in display order.
export function changedIds(
  permissions: readonly Shown[],
  cells: Readonly<Record<string, Cell>>,
  entries: Readonly<Record<string, MatrixValue>>,
  allowNo: boolean,
): string[] {
  return permissions
    .filter((permission) =>
      isChanged(
        permission,
        cells[permission.id],
        entries[permission.id],
        allowNo,
      ),
    )
    .map((permission) => permission.id);
}

// The cells after a bulk button: every yes/no permission of `rows` (a tab's or a category's)
// set to `mode`; integer rows and every other row keep what they hold.
export function bulkSet(
  cells: Readonly<Record<string, Cell>>,
  rows: readonly Shown[],
  mode: BulkMode,
): Record<string, Cell> {
  const next = { ...cells };
  for (const row of rows) {
    if (row.type === "flag") next[row.id] = { mode, amount: "" };
  }
  return next;
}
