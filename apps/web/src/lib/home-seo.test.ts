import { expect, test } from "bun:test";
import { forumListAddress, homeAddress, homeMetadata } from "./home-seo";
import { HOME_TABS, type HomeTab } from "./home-tabs";

const address = (
  opened: HomeTab,
  params: Record<string, string | string[]> = {},
  guestTab: HomeTab = "latest",
) => homeAddress({ opened, guestTab, params });

test("the bare address is the canonical of the tab guests open on, and is indexed", () => {
  expect(address("latest")).toEqual({ path: "/whats-new", index: true });
  expect(address("hot", {}, "hot")).toEqual({
    path: "/whats-new",
    index: true,
  });
  expect(address("media", {}, "media")).toEqual({
    path: "/whats-new",
    index: true,
  });
});

test("naming the guests' own tab points at the bare address", () => {
  expect(address("latest", { tab: "latest" })).toEqual({
    path: "/whats-new",
    index: true,
  });
  expect(address("hot", { tab: "hot" }, "hot")).toEqual({
    path: "/whats-new",
    index: true,
  });
});

test("every other public tab has its own named address", () => {
  expect(address("hot", { tab: "hot" })).toEqual({
    path: "/whats-new?tab=hot",
    index: true,
  });
  expect(address("media", { tab: "media" })).toEqual({
    path: "/whats-new?tab=media",
    index: true,
  });
});

test("a member who opens on another tab at the bare address gets that tab's named address", () => {
  expect(address("hot")).toEqual({ path: "/whats-new?tab=hot", index: true });
});

test("a guest default of following is Latest: guests never open Following", () => {
  expect(address("latest", {}, "following").path).toBe("/whats-new");
});

test("Following is the viewer's own list: never indexed", () => {
  expect(address("following", { tab: "following" })).toEqual({
    path: "/whats-new?tab=following",
    index: false,
  });
  expect(address("following").index).toBe(false);
});

test("a guest who asks for Following is shown Latest as a copy of it", () => {
  expect(address("latest", { tab: "following" })).toEqual({
    path: "/whats-new",
    index: false,
  });
});

test("a cursor, pages, a feed filter, or a picture make a copy of the tab", () => {
  const variants: Record<string, string>[] = [
    { cursor: "abc" },
    { pages: "3" },
    { forums: "3,4" },
    { prefix: "2" },
    { type: "sticky" },
    { tag: "rust" },
    { watched: "1" },
    { unread: "1" },
    { picture: "12" },
    { anything: "else" },
  ];
  for (const variant of variants) {
    const label = JSON.stringify(variant);
    expect(address("hot", { tab: "hot", ...variant }), label).toEqual({
      path: "/whats-new?tab=hot",
      index: false,
    });
    expect(address("latest", variant), label).toEqual({
      path: "/whats-new",
      index: false,
    });
  }
});

test("tracking parameters and the referral code do not make a copy", () => {
  for (const key of [
    "utm_source",
    "utm_campaign",
    "UTM_Medium",
    "fbclid",
    "gclid",
    "ref",
  ]) {
    expect(address("latest", { [key]: "x" }), key).toEqual({
      path: "/whats-new",
      index: true,
    });
    expect(address("hot", { tab: "hot", [key]: "x" }), key).toEqual({
      path: "/whats-new?tab=hot",
      index: true,
    });
  }
  // With a real variant beside them the address is still a copy.
  expect(
    address("hot", { tab: "hot", utm_source: "x", cursor: "c" }).index,
  ).toBe(false);
  // And an unlisted parameter that merely looks like tracking is not ignored.
  expect(address("latest", { utmx: "x", reference: "y" }).index).toBe(false);
});

test("a tab that names none, or names two, is a copy of the tab the page opened", () => {
  expect(address("latest", { tab: "top" })).toEqual({
    path: "/whats-new",
    index: false,
  });
  expect(address("hot", { tab: ["hot", "media"] })).toEqual({
    path: "/whats-new?tab=hot",
    index: false,
  });
});

test("only the plain address of a public tab is indexed, whatever the tab", () => {
  for (const tab of HOME_TABS) {
    expect(address(tab, { tab }).index).toBe(tab !== "following");
    expect(address(tab, { tab, cursor: "x" }).index).toBe(false);
  }
});

test("the forum list has the bare address; a section, statistics tab or notice is a copy of it", () => {
  expect(forumListAddress({})).toEqual({ path: "/", index: true });
  expect(forumListAddress({ utm_source: "x", ref: "7" })).toEqual({
    path: "/",
    index: true,
  });
  for (const variant of [
    { section: "5" },
    { stats: "members" },
    { notice: "accountDeleted" },
    { anything: "else" },
  ])
    expect(forumListAddress(variant), JSON.stringify(variant)).toEqual({
      path: "/",
      index: false,
    });
});

test("the head carries the title, description, canonical and robots, and no Open Graph card", () => {
  const head = homeMetadata({
    address: { path: "/whats-new?tab=hot", index: true },
    origin: "https://forum.example",
    title: "Hot threads",
    description: "Hot on Garden Club.",
  });
  expect(head).toEqual({
    title: "Hot threads",
    description: "Hot on Garden Club.",
    alternates: { canonical: "https://forum.example/whats-new?tab=hot" },
    robots: { index: true, follow: true },
  });
});

test("a copy is noindex, follow, and points at its tab", () => {
  const head = homeMetadata({
    address: { path: "/whats-new", index: false },
    origin: "https://forum.example",
    title: "t",
    description: "d",
  });
  expect(head.robots).toEqual({ index: false, follow: true });
  expect(head.alternates?.canonical).toBe("https://forum.example/whats-new");
});
