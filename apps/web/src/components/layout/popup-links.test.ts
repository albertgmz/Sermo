import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { closesPopup } from "./popup-links";

const inside = (matches: string[]) =>
  ({
    closest: (selector: string) => (matches.includes(selector) ? {} : null),
  }) as never;

test("a click on a link closes the popup, and one elsewhere does not", () => {
  expect(closesPopup(inside(["a"]))).toBe(true);
  expect(closesPopup(inside([]))).toBe(false);
  expect(closesPopup(null)).toBe(false);
  expect(closesPopup({} as never)).toBe(false);
});

test("the menu also closes on what asks for it, by the selector it passes", () => {
  const selector = "a, [data-menu-close]";
  expect(closesPopup(inside([selector]), selector)).toBe(true);
  expect(closesPopup(inside(["a"]), selector)).toBe(false);
});

// Next's `Link` cancels the default of the click it follows, so a popup that asked whether the
// click was cancelled stayed open over the page it had opened.
test("neither popup judges a click by whether its default was cancelled", () => {
  for (const file of ["user-menu-popup.tsx", "header-panel-popup.tsx"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    expect(source, file).toContain("closesPopup(");
    expect(source, file).not.toContain("defaultPrevented");
  }
});
