import { expect, test } from "bun:test";
import { PICKER_CLASS, pickerRows, pickerStyle } from "./reaction-button";

// The layout itself needs a browser; what a test can hold is that the classes which bound the
// picker's width are there and that its rows and sizes follow `pickerGrid`.
test("the reaction picker stacks centred rows and never outgrows the viewport", () => {
  const classes = PICKER_CLASS.split(" ");
  expect(classes).toContain("flex-col");
  expect(classes).toContain("items-center");
  expect(classes).toContain("max-w-[calc(100vw-2rem)]");
  // No fixed width that would stop it from shrinking to the viewport.
  expect(classes.some((name) => /^w-(?!auto$)/.test(name))).toBe(false);
});

test("the reaction size comes from the grid", () => {
  expect(pickerStyle({ rows: [6, 6], cell: 52 })).toEqual({
    "--cell": "52px",
    fontSize: "28px",
  });
  expect(pickerStyle({ rows: [7, 7], cell: 40 }).fontSize).toBe("22px");
});

test("the reactions are cut into the grid's rows in order", () => {
  expect(pickerRows([1, 2, 3, 4, 5, 6, 7], [3, 2, 2])).toEqual([
    [1, 2, 3],
    [4, 5],
    [6, 7],
  ]);
  expect(pickerRows(["a", "b"], [2])).toEqual([["a", "b"]]);
});
