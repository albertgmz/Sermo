import { expect, test } from "bun:test";
import { referrerOf, shareAddress } from "./link";

const ORIGIN = "https://forum.test";

test("a member's link carries their id", () => {
  expect(shareAddress("/threads/3-hello", ORIGIN, 12)).toBe(
    "https://forum.test/threads/3-hello?ref=12",
  );
});

test("a guest's link is the plain address", () => {
  expect(shareAddress("/threads/3-hello", ORIGIN, null)).toBe(
    "https://forum.test/threads/3-hello",
  );
  expect(shareAddress("/threads/3?page=2#post-9", ORIGIN, null)).toBe(
    "https://forum.test/threads/3?page=2#post-9",
  );
});

test("a link with a query keeps it, a link with a hash keeps it", () => {
  expect(shareAddress("/threads/3?page=2", ORIGIN, 12)).toBe(
    "https://forum.test/threads/3?page=2&ref=12",
  );
  expect(shareAddress("/threads/3#post-9", ORIGIN, 12)).toBe(
    "https://forum.test/threads/3?ref=12#post-9",
  );
  expect(shareAddress("/threads/3?page=2&x=a%20b#post-9", ORIGIN, 12)).toBe(
    "https://forum.test/threads/3?page=2&x=a%20b&ref=12#post-9",
  );
});

test("a link that already names a referrer is given the sharer's, once", () => {
  expect(shareAddress("/threads/3?ref=5&page=2", ORIGIN, 12)).toBe(
    "https://forum.test/threads/3?page=2&ref=12",
  );
  expect(shareAddress("/?ref=5&ref=6#top", ORIGIN, 12)).toBe(
    "https://forum.test/?ref=12#top",
  );
});

test("an address that is already whole keeps its own origin", () => {
  expect(shareAddress("https://other.test/a", ORIGIN, 3)).toBe(
    "https://other.test/a?ref=3",
  );
});

test("a referrer is a positive whole number in plain decimal", () => {
  expect(referrerOf("12")).toBe(12);
  expect(referrerOf(["12", "13"])).toBe(12);
  for (const bad of [
    "",
    "0",
    "-1",
    "1.5",
    "012",
    "1e3",
    "0x1f",
    " 4",
    "9007199254740993",
    undefined,
    null,
    [],
    ["x", "4"],
  ]) {
    expect(referrerOf(bad), String(bad)).toBeNull();
  }
});
