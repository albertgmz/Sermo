import { expect, test } from "bun:test";
import { ICON_ENTRIES, searchIcons } from "./icon-meta";
import { ICONS, iconComponent } from "./icon-set";

// The keys the forum icon map knew before the set existed, and the ones the navigation draws by
// default: stored values and built-in entries must keep resolving.
const LEGACY_FORUM_KEYS = [
  "bitcoin",
  "briefcase-business",
  "brush",
  "chart-line",
  "earth",
  "gamepad-2",
  "gift",
  "hand",
  "handshake",
  "layout-template",
  "lightbulb",
  "link-2",
  "megaphone",
  "message-circle-more",
  "newspaper",
  "rocket",
  "shopping-cart",
  "square-terminal",
  "store",
  "wrench",
];
const NAVIGATION_KEYS = [
  "house",
  "messages-square",
  "inbox",
  "bell",
  "user-round",
  "log-in",
  "link",
  "settings",
  "crown",
];

test("every key of the former forum map and of the navigation resolves", () => {
  for (const key of [...LEGACY_FORUM_KEYS, ...NAVIGATION_KEYS])
    expect(iconComponent(key)).not.toBeNull();
});

test("an unknown, empty or inherited key resolves to nothing and never throws", () => {
  expect(iconComponent("no-such-icon")).toBeNull();
  expect(iconComponent("")).toBeNull();
  expect(iconComponent(null)).toBeNull();
  expect(iconComponent(undefined)).toBeNull();
  expect(iconComponent("constructor")).toBeNull();
  expect(iconComponent("__proto__")).toBeNull();
});

test("the set is a hundred or more icons and every key has the shape the backend accepts", () => {
  const keys = Object.keys(ICONS);
  expect(keys.length).toBeGreaterThanOrEqual(100);
  expect(keys.length).toBeLessThanOrEqual(200);
  for (const key of keys) expect(key).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
});

test("the picker's entries are the keys of the set, once each, with a label", () => {
  const entries = ICON_ENTRIES.map((entry) => entry.key);
  expect(new Set(entries).size).toBe(entries.length);
  expect([...entries].sort()).toEqual(Object.keys(ICONS).sort());
  for (const entry of ICON_ENTRIES)
    expect(entry.label.length).toBeGreaterThan(0);
});

test("a search keeps the icons that match every word, by key, label or search word", () => {
  expect(searchIcons("")).toBe(ICON_ENTRIES);
  expect(searchIcons("   ")).toBe(ICON_ENTRIES);
  const keys = (query: string) => searchIcons(query).map((e) => e.key);
  expect(keys("gamepad")).toContain("gamepad-2");
  expect(keys("CRYPTO")).toContain("bitcoin");
  expect(keys("pets animals")).toEqual(["paw-print", "dog", "cat"]);
  expect(keys("money coin")).toContain("coins");
  expect(keys("money coin")).not.toContain("gamepad-2");
  expect(keys("zzzz")).toEqual([]);
});
