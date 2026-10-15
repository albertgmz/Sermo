import { expect, test } from "bun:test";
import {
  accountItems,
  iconFor,
  isActivePath,
  isCurrent,
  linkProps,
  mobileItems,
  toNavItems,
} from "./nav";

type Entry = {
  id: number;
  title: string;
  target: string | null;
  builtin: string | null;
  icon: string | null;
  iconPosition: "before" | "after";
  children: Entry[];
};

let next = 0;
function entry(
  builtin: string | null,
  target: string | null,
  title = builtin ?? "Custom",
  children: Entry[] = [],
): Entry {
  next += 1;
  return {
    id: next,
    title,
    target,
    builtin,
    icon: null,
    iconPosition: "before",
    children,
  };
}

const [forums, custom, external, heading] = toNavItems([
  entry("header.forums", "/forums"),
  entry(null, "/pages/rules", "Rules"),
  entry(null, "https://example.test/a"),
  entry("footer.legal", null, "Legal", [entry(null, "/terms")]),
]);

test("a path is current for itself and its sub-paths; the root only for itself", () => {
  expect(isActivePath("/", "/")).toBe(true);
  expect(isActivePath("/forums", "/")).toBe(false);
  expect(isActivePath("/members/3", "/members")).toBe(true);
  expect(isActivePath("/membersx", "/members")).toBe(false);
  expect(isActivePath("/threads/1", "/forums", ["/threads"])).toBe(true);
});

test("the forums entries also match threads and the mobile profile matches the account", () => {
  expect(isCurrent("/threads/1", forums)).toBe(true);
  expect(isCurrent("/forums", forums)).toBe(true);
  expect(isCurrent("/threads/1", custom)).toBe(false);
  const [mobileForums, profile] = toNavItems(
    [entry("mobile.forums", "/forums"), entry("mobile.profile", "/members")],
    "/members/7",
  );
  expect(isCurrent("/threads/1", mobileForums)).toBe(true);
  expect(isCurrent("/account/data-saver", profile)).toBe(true);
  expect(isCurrent("/members/7", profile)).toBe(true);
});

test("any other entry matches its own path and sub-paths, ignoring a query", () => {
  expect(isCurrent("/pages/rules", custom)).toBe(true);
  expect(isCurrent("/pages/rules/x", custom)).toBe(true);
  expect(isCurrent("/pages", custom)).toBe(false);
  const [withQuery] = toNavItems([entry(null, "/search?q=a")]);
  expect(isCurrent("/search", withQuery)).toBe(true);
});

test("the profile entries lead to the member's own page", () => {
  const entries = [
    entry("mobile.profile", "/members"),
    entry("account.profile", "/members"),
    entry("mobile.home", "/"),
  ];
  expect(toNavItems(entries, "/members/7").map((item) => item.href)).toEqual([
    "/members/7",
    "/members/7",
    "/",
  ]);
  // Without a member the stored target stays.
  expect(toNavItems(entries).map((item) => item.href)).toEqual([
    "/members",
    "/members",
    "/",
  ]);
});

test("an external target opens safely and is never current", () => {
  expect(external.external).toBe(true);
  expect(isCurrent("/", external)).toBe(false);
  expect(isCurrent("/a", external)).toBe(false);
  expect(linkProps({ ...external, href: "https://example.test/a" })).toEqual({
    href: "https://example.test/a",
    target: "_blank",
    rel: "noopener noreferrer",
  });
  expect(linkProps({ ...custom, href: "/pages/rules" })).toEqual({
    href: "/pages/rules",
  });
});

test("a heading has no link and is never current", () => {
  expect(heading.href).toBeNull();
  expect(isCurrent("/", heading)).toBe(false);
  expect(heading.children[0].href).toBe("/terms");
});

test("the mobile bar keeps entries with a target, at most five", () => {
  const items = toNavItems([
    entry(null, null, "Heading", [entry(null, "/a")]),
    ...[1, 2, 3, 4, 5, 6].map((n) => entry(null, `/p${n}`)),
  ]);
  const shown = mobileItems(items);
  expect(shown.map((item) => item.href)).toEqual([
    "/p1",
    "/p2",
    "/p3",
    "/p4",
    "/p5",
  ]);
  expect(shown.every((item) => item.children.length === 0)).toBe(true);
});

test("the account menu is a flat list in the data's order", () => {
  const items = toNavItems([
    entry("account.profile", "/members"),
    entry(null, null, "More", [entry(null, "/a"), entry(null, "/b")]),
  ]);
  expect(accountItems(items).map((item) => item.href)).toEqual([
    "/members",
    "/a",
    "/b",
  ]);
});

test("known keys have their own icon and every other entry a generic one", () => {
  expect(iconFor("mobile.home")).not.toBe(iconFor(null));
  expect(iconFor("mobile.messages")).not.toBe(iconFor("mobile.alerts"));
  expect(iconFor("account.upgrade")).not.toBe(iconFor(null));
  expect(iconFor("account.bookmarks")).not.toBe(iconFor(null));
  expect(iconFor("something.else")).toBe(iconFor(null));
});
