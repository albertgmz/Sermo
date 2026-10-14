import { expect, test } from "bun:test";
import { parseDismissed, withDismissed } from "./notice-dismissals";

test("the cookie holds the dismissed ids, ignoring anything that is not an id", () => {
  expect(parseDismissed(undefined)).toEqual([]);
  expect(parseDismissed("3.7")).toEqual([3, 7]);
  expect(parseDismissed("3..x.0.-2.7")).toEqual([3, 7]);
});

test("a dismissal is added once and the oldest drop when the cookie is full", () => {
  expect(withDismissed(undefined, 4)).toBe("4");
  expect(withDismissed("4.5", 4)).toBe("5.4");
  const full = Array.from({ length: 50 }, (_, index) => index + 1).join(".");
  const next = parseDismissed(withDismissed(full, 99));
  expect(next).toHaveLength(50);
  expect(next[0]).toBe(2);
  expect(next.at(-1)).toBe(99);
});
