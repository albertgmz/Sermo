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

// Reads the matrix back from a submitted form and returns only the entries that differ from
// `current` (the target's entries as the backend returned them when the page was built), as the
// entries `permissions.set` takes. Only definitions the caller passes are read, and only those
// whose select the form carried; a value outside the permission's states, or an integer that is
// not a whole number, is reported by `invalid` (the permission id) and nothing is returned.
//
//   formData     The submitted form.
//   definitions  The permissions the form showed.
//   current      The entries of the target now, by permission id (unset ones absent).
//   allowNo      Whether "no" is a state (forum scope only).
export function matrixChanges(
  formData: FormData,
  definitions: readonly MatrixDefinition[],
  current: Readonly<Record<string, MatrixValue>>,
  allowNo: boolean,
): { changes: EntryChange[] } | { invalid: string } {
  const changes: EntryChange[] = [];
  for (const definition of definitions) {
    const mode = formData.get(modeField(definition.id));
    if (typeof mode !== "string") continue;
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
    const now = current[definition.id];
    if (wanted === "unset" ? now !== undefined : wanted !== now) {
      changes.push({ permission: definition.id, value: wanted });
    }
  }
  return { changes };
}
