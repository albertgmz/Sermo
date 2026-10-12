// The form fields of the permission matrix (permission-matrix.tsx) and what an action makes of
// them. Not a server-only module and not a client one: the matrix names its controls with
// `modeField` and `numberField`, the action reads them back with `matrixChanges`.
//
// A value as the backend holds it: "allow", "never", "no" (on a forum: clears an inherited allow
// for this group only) for a yes/no permission, a whole number (-1 unlimited) for an integer one.

export type MatrixValue = "allow" | "no" | "never" | number;

// What `matrixChanges` needs of a definition (`permissions.definitions` items have these).
export type MatrixDefinition = {
  id: string;
  type: "flag" | "integer";
  scope: "global" | "node";
};

export type EntryChange = {
  permission: string;
  value: MatrixValue | "unset";
};

// The select of a permission: "" (not set), a yes/no value, or for an integer "value" or "unlimited".
export const modeField = (id: string) => `perm:${id}`;
// The number typed for an integer permission when its mode is "value".
export const numberField = (id: string) => `num:${id}`;
// The hidden field that carries what the cell showed when the page was built.
export const wasField = (id: string) => `was:${id}`;

// A cell's value as text, the way the hidden `was` field and the posted select are compared:
// "" for not set, the state of a yes/no permission, the number of an integer one (-1 unlimited).
export const cellText = (value: MatrixValue | undefined): string =>
  value === undefined ? "" : String(value);

// Reads the matrix back from a submitted form and returns only the entries the administrator
// changed, as the entries `permissions.set` takes. A cell is changed when its posted value differs
// from what it showed when the page was built, which the form carries in a hidden `was` field
// (`cellText`). The comparison is not made with a fresh read of the target: a cell the
// administrator did not touch but someone else changed meanwhile is left as that other
// administrator set it. Only definitions the caller passes are read, and only those whose select
// and `was` field the form carried; a value outside the permission's states, or an integer that
// is not a whole number, is reported by `invalid` (the permission id) and nothing is returned.
//
//   formData     The submitted form.
//   definitions  The permissions the form showed.
//   allowNo      Whether "no" is a state (forum scope only).
export function matrixChanges(
  formData: FormData,
  definitions: readonly MatrixDefinition[],
  allowNo: boolean,
): { changes: EntryChange[] } | { invalid: string } {
  const changes: EntryChange[] = [];
  for (const definition of definitions) {
    const mode = formData.get(modeField(definition.id));
    const was = formData.get(wasField(definition.id));
    if (typeof mode !== "string" || typeof was !== "string") continue;
    let wanted: MatrixValue | "unset";
    if (mode === "") {
      wanted = "unset";
    } else if (definition.type === "flag") {
      if (mode === "allow" || mode === "never" || (allowNo && mode === "no")) {
        wanted = mode;
      } else {
        return { invalid: definition.id };
      }
    } else if (mode === "unlimited") {
      wanted = -1;
    } else if (mode === "value") {
      const typed = formData.get(numberField(definition.id));
      if (typeof typed !== "string" || !/^\d{1,15}$/.test(typed.trim())) {
        return { invalid: definition.id };
      }
      wanted = Number(typed.trim());
    } else {
      return { invalid: definition.id };
    }
    if (cellText(wanted === "unset" ? undefined : wanted) !== was) {
      changes.push({ permission: definition.id, value: wanted });
    }
  }
  return { changes };
}
