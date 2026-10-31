import { expect, test } from "bun:test";
import { busyOf, holdAt, pressAt, pressed, settle } from "./pending-choice";

// The forum's address is its id with the slug: the proxy sends the id alone there.
const here = new URL("http://site.test/forums/2-general?prefix=3&page=2");
const menu = { newTab: false, inMenu: true };

test("a menu choice that opens this page with another query is a press, made at the address on screen", () => {
  expect(pressAt("/forums/2-general?prefix=5", here, menu)).toBe(
    "prefix=3&page=2",
  );
  expect(pressAt("/forums/2-general", here, menu)).toBe("prefix=3&page=2");
});

test("anything else is not a press", () => {
  const other = (href: string, flags = menu) => pressAt(href, here, flags);
  // Another page: the id with no slug is another path than the one the request came in by.
  expect(other("/forums/2?prefix=5")).toBeNull();
  expect(other("/threads/8")).toBeNull();
  expect(other("http://other.test/forums/2-general?prefix=5")).toBeNull();
  // A new tab, a link outside the menu (a pager, a thread), the choice already on screen.
  expect(
    other("/forums/2-general?prefix=5", { ...menu, newTab: true }),
  ).toBeNull();
  expect(
    other("/forums/2-general?page=3", { ...menu, inMenu: false }),
  ).toBeNull();
  expect(other("/forums/2-general?prefix=3&page=2")).toBeNull();
});

test("the part is not busy until a press, and a press that no link makes changes nothing", () => {
  const held = holdAt("prefix=3&page=2");
  expect(busyOf(held)).toBe(false);
  expect(busyOf(pressed(held, null))).toBe(false);
});

test("the part waits after a press while the address stays", () => {
  const held = pressed(holdAt("prefix=3&page=2"), "prefix=3&page=2");
  expect(busyOf(held)).toBe(true);
  expect(busyOf(settle(held, "prefix=3&page=2"))).toBe(true);
});

test("the choice arriving ends the wait", () => {
  const held = pressed(holdAt("prefix=3&page=2"), "prefix=3&page=2");
  expect(busyOf(settle(held, "prefix=5"))).toBe(false);
});

test("Back or Forward ends the wait, and the old press does not come back at the address it was made at", () => {
  const press = pressed(holdAt("prefix=3"), "prefix=3");
  // The press is overtaken by Back before it commits.
  expect(busyOf(settle(press, ""))).toBe(false);
  // The choice committed, then Back to where the press was made.
  const arrived = settle(press, "prefix=5");
  expect(busyOf(arrived)).toBe(false);
  expect(busyOf(settle(arrived, "prefix=3"))).toBe(false);
  // Forward again.
  expect(busyOf(settle(settle(arrived, "prefix=3"), "prefix=5"))).toBe(false);
});
