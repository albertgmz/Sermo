import { expect, test } from "bun:test";
import { PICKER_CLASS, pickerStyle } from "./reaction-button";

// The layout itself needs a browser; what a test can hold is that the classes which bound the
// picker's width are there and that the grid follows `pickerGrid`.
test("the reaction picker is a grid that never outgrows the viewport", () => {
  const classes = PICKER_CLASS.split(" ");
  expect(classes).toContain("grid");
  expect(classes).toContain("max-w-[calc(100vw-2rem)]");
  // No fixed width that would stop it from shrinking to the viewport.
  expect(classes.some((name) => /^w-(?!auto$)/.test(name))).toBe(false);
});

test("the picker's columns and reaction size come from its grid", () => {
  expect(pickerStyle({ columns: 6, cell: 52 })).toEqual({
    gridTemplateColumns: "repeat(6, 52px)",
    gridAutoRows: "52px",
    fontSize: "28px",
  });
  expect(pickerStyle({ columns: 7, cell: 40 }).fontSize).toBe("22px");
});
