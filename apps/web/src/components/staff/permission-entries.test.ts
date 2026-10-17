import { expect, test } from "bun:test";
import { cellChanged, cellValue, matrixChanges } from "./permission-entries";

const definitions = [
  { id: "a.flag", type: "flag", scope: "global" },
  { id: "b.count", type: "integer", scope: "global" },
] as const;

// `was` is what each cell showed when the page was built, by permission id: a cell absent from it
// showed "not set".
function form(
  fields: Record<string, string>,
  was: Record<string, string> = {},
) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  for (const name of Object.keys(fields)) {
    if (name.startsWith("perm:")) {
      const id = name.slice(5);
      data.set(`was:${id}`, was[id] ?? "");
    }
  }
  return data;
}

test("only entries that differ from what the cells showed are returned", () => {
  expect(
    matrixChanges(
      form(
        { "perm:a.flag": "allow", "perm:b.count": "unlimited" },
        { "a.flag": "allow" },
      ),
      definitions,
      false,
    ),
  ).toEqual({ changes: [{ permission: "b.count", value: -1 }] });
});

test("an integer is compared as the number it showed", () => {
  expect(
    matrixChanges(
      form(
        { "perm:b.count": "value", "num:b.count": "05" },
        { "b.count": "5" },
      ),
      definitions,
      false,
    ),
  ).toEqual({ changes: [] });
  expect(
    matrixChanges(
      form({ "perm:b.count": "value", "num:b.count": "6" }, { "b.count": "5" }),
      definitions,
      false,
    ),
  ).toEqual({ changes: [{ permission: "b.count", value: 6 }] });
});

test("an empty select removes an entry that exists and ignores one that does not", () => {
  expect(
    matrixChanges(
      form({ "perm:a.flag": "", "perm:b.count": "" }, { "a.flag": "never" }),
      definitions,
      false,
    ),
  ).toEqual({ changes: [{ permission: "a.flag", value: "unset" }] });
});

test("a control the form did not carry is left alone", () => {
  expect(matrixChanges(form({}), definitions, false)).toEqual({ changes: [] });
  // Nor one that came without the value it showed.
  const data = new FormData();
  data.set("perm:a.flag", "never");
  expect(matrixChanges(data, definitions, false)).toEqual({ changes: [] });
});

test("a value outside the permission states or not a whole number is invalid", () => {
  expect(
    matrixChanges(form({ "perm:a.flag": "no" }), definitions, false),
  ).toEqual({ invalid: "a.flag" });
  expect(
    matrixChanges(form({ "perm:a.flag": "maybe" }), definitions, true),
  ).toEqual({ invalid: "a.flag" });
  expect(
    matrixChanges(
      form({ "perm:b.count": "value", "num:b.count": "2.5" }),
      definitions,
      false,
    ),
  ).toEqual({ invalid: "b.count" });
  expect(
    matrixChanges(form({ "perm:b.count": "allow" }), definitions, false),
  ).toEqual({ invalid: "b.count" });
});

test("No is a state only where the caller allows it", () => {
  expect(
    matrixChanges(form({ "perm:a.flag": "no" }), definitions, true),
  ).toEqual({ changes: [{ permission: "a.flag", value: "no" }] });
});

test("a cell is read the same way by the matrix's counter and by the action", () => {
  expect(cellValue("flag", "", null, false)).toBe("unset");
  expect(cellValue("flag", "never", null, false)).toBe("never");
  expect(cellValue("flag", "no", null, false)).toBeNull();
  expect(cellValue("flag", "no", null, true)).toBe("no");
  expect(cellValue("integer", "unlimited", null, false)).toBe(-1);
  expect(cellValue("integer", "value", " 7 ", false)).toBe(7);
  expect(cellValue("integer", "value", "", false)).toBeNull();
  expect(cellValue("integer", "allow", null, false)).toBeNull();
  expect(cellChanged("unset", "")).toBe(false);
  expect(cellChanged("unset", "allow")).toBe(true);
  expect(cellChanged(-1, "-1")).toBe(false);
  expect(cellChanged(null, "")).toBe(true);
});
