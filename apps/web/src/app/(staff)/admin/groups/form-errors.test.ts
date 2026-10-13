import { expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
const { criteriaOf, orderRefusal } = await import("./form-errors");

test("a refusal part-way names the row and counts what was saved", () => {
  expect(orderRefusal(1, 3, "Rules", "Not allowed.")).toEqual({
    key: "partial",
    values: { saved: 1, total: 3, title: "Rules", message: "Not allowed." },
  });
});

test("a refusal of the first change says that nothing was saved", () => {
  expect(orderRefusal(0, 2, "Home", "Not allowed.").key).toBe("none");
});

test("criteria are read for the offered ids that are ticked, with whole values", () => {
  const offered = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const form = (entries: [string, string][]) => {
    const data = new FormData();
    for (const [name, value] of entries) data.append(name, value);
    return data;
  };
  expect(
    criteriaOf(
      offered,
      form([
        ["use:a", "on"],
        ["value:a", " 5 "],
        ["value:b", "9"],
        ["use:c", "on"],
        ["value:c", "0"],
        ["use:invented", "on"],
        ["value:invented", "1"],
      ]),
    ),
  ).toEqual([
    { criterion: "a", value: 5 },
    { criterion: "c", value: 0 },
  ]);
  expect(
    criteriaOf(
      offered,
      form([
        ["use:a", "on"],
        ["value:a", "x"],
      ]),
    ),
  ).toBeNull();
  expect(criteriaOf(offered, form([["use:a", "on"]]))).toBeNull();
});
