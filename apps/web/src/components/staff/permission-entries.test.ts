import { expect, test } from "bun:test";
import { matrixChanges } from "./permission-entries";

const definitions = [
  { id: "a.flag", type: "flag", scope: "global" },
  { id: "b.count", type: "integer", scope: "global" },
] as const;

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

test("only entries that differ from the current ones are returned", () => {
  expect(
    matrixChanges(
      form({ "perm:a.flag": "allow", "perm:b.count": "unlimited" }),
      definitions,
      { "a.flag": "allow" },
      false,
    ),
  ).toEqual({ changes: [{ permission: "b.count", value: -1 }] });
});

test("an empty select removes an entry that exists and ignores one that does not", () => {
  expect(
    matrixChanges(
      form({ "perm:a.flag": "", "perm:b.count": "" }),
      definitions,
      { "a.flag": "never" },
      false,
    ),
  ).toEqual({ changes: [{ permission: "a.flag", value: "unset" }] });
});

test("a control the form did not carry is left alone", () => {
  expect(
    matrixChanges(form({}), definitions, { "a.flag": "allow" }, false),
  ).toEqual({ changes: [] });
});

test("a value outside the permission states or not a whole number is invalid", () => {
  expect(
    matrixChanges(form({ "perm:a.flag": "no" }), definitions, {}, false),
  ).toEqual({ invalid: "a.flag" });
  expect(
    matrixChanges(form({ "perm:a.flag": "maybe" }), definitions, {}, true),
  ).toEqual({ invalid: "a.flag" });
  expect(
    matrixChanges(
      form({ "perm:b.count": "value", "num:b.count": "2.5" }),
      definitions,
      {},
      false,
    ),
  ).toEqual({ invalid: "b.count" });
  expect(
    matrixChanges(form({ "perm:b.count": "allow" }), definitions, {}, false),
  ).toEqual({ invalid: "b.count" });
});

test("No is a state only where the caller allows it", () => {
  expect(
    matrixChanges(form({ "perm:a.flag": "no" }), definitions, {}, true),
  ).toEqual({ changes: [{ permission: "a.flag", value: "no" }] });
});
