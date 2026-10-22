import { expect, test } from "bun:test";
import { stripHasMore, stripStep } from "./tab-strip-arrow";

test("the arrow shows while tabs lie beyond the strip's right edge", () => {
  expect(
    stripHasMore({ scrollLeft: 0, clientWidth: 360, scrollWidth: 620 }),
  ).toBe(true);
  expect(
    stripHasMore({ scrollLeft: 200, clientWidth: 360, scrollWidth: 620 }),
  ).toBe(true);
  // Scrolled to the end, with a fraction of a pixel left from rounding.
  expect(
    stripHasMore({ scrollLeft: 259.5, clientWidth: 360, scrollWidth: 620 }),
  ).toBe(false);
  // A strip whose tabs all fit.
  expect(
    stripHasMore({ scrollLeft: 0, clientWidth: 900, scrollWidth: 900 }),
  ).toBe(false);
});

test("a press scrolls most of the strip's width, keeping the last tab seen in sight", () => {
  expect(stripStep({ scrollLeft: 0, clientWidth: 360, scrollWidth: 620 })).toBe(
    270,
  );
});
