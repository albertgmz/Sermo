import { expect, test } from "bun:test";
import { PICKER_CLASS } from "./reaction-button";

// The layout itself needs a browser; what a test can hold is that the classes which bound the
// picker's width and let its buttons wrap are there.
test("the reaction picker wraps and never outgrows the viewport", () => {
  const classes = PICKER_CLASS.split(" ");
  expect(classes).toContain("flex-row");
  expect(classes).toContain("flex-wrap");
  expect(classes).toContain("max-w-[calc(100vw-2rem)]");
  expect(classes).not.toContain("flex-nowrap");
  // No fixed width that would stop it from shrinking to the viewport.
  expect(classes.some((name) => /^w-(?!auto$)/.test(name))).toBe(false);
});
