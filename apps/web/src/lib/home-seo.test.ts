import { expect, test } from "bun:test";
import { homeAddress, homeMetadata } from "./home-seo";
import { HOME_TABS, type HomeTab } from "./home-tabs";

const address = (
  opened: HomeTab,
  params: Record<string, string | string[]> = {},
  guestTab: HomeTab = "latest",
) => homeAddress({ opened, guestTab, params });

test("the bare address is the canonical of the tab guests open on, and is indexed", () => {
  expect(address("latest")).toEqual({ path: "/", index: true });
  expect(address("hot", {}, "hot")).toEqual({ path: "/", index: true });
  expect(address("forums", {}, "forums")).toEqual({ path: "/", index: true });
});

test("naming the guests' own tab points at the bare address", () => {
  expect(address("latest", { tab: "latest" })).toEqual({
    path: "/",
    index: true,
  });
  expect(address("hot", { tab: "hot" }, "hot")).toEqual({
    path: "/",
    index: true,
  });
});

test("every other public tab has its own named address", () => {
  expect(address("hot", { tab: "hot" })).toEqual({
    path: "/?tab=hot",
    index: true,
  });
  expect(address("media", { tab: "media" })).toEqual({
    path: "/?tab=media",
    index: true,
  });
  expect(address("forums", { tab: "forums" })).toEqual({
    path: "/?tab=forums",
    index: true,
  });
});

test("a member who opens on another tab at the bare address gets that tab's named address", () => {
  expect(address("hot")).toEqual({ path: "/?tab=hot", index: true });
});

test("a guest default of following is Latest: guests never open Following", () => {
  expect(address("latest", {}, "following").path).toBe("/");
});

test("Following is the viewer's own list: never indexed", () => {
  expect(address("following", { tab: "following" })).toEqual({
    path: "/?tab=following",
    index: false,
  });
  expect(address("following").index).toBe(false);
});

test("a guest who asks for Following is shown Latest as a copy of it", () => {
  expect(address("latest", { tab: "following" })).toEqual({
    path: "/",
    index: false,
  });
});

test("a cursor, pages, a feed filter, a picture, a section or a notice make a copy of the tab", () => {
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
    { section: "5" },
    { stats: "members" },
    { notice: "accountDeleted" },
    { anything: "else" },
  ];
  for (const variant of variants) {
    const label = JSON.stringify(variant);
    expect(address("hot", { tab: "hot", ...variant }), label).toEqual({
      path: "/?tab=hot",
      index: false,
    });
    expect(address("latest", variant), label).toEqual({
      path: "/",
      index: false,
    });
  }
});

test("a tab that names none, or names two, is a copy of the tab the page opened", () => {
  expect(address("latest", { tab: "top" })).toEqual({
    path: "/",
    index: false,
  });
  expect(address("hot", { tab: ["hot", "media"] })).toEqual({
    path: "/?tab=hot",
    index: false,
  });
});

test("only the plain address of a public tab is indexed, whatever the tab", () => {
  for (const tab of HOME_TABS) {
    expect(address(tab, { tab }).index).toBe(tab !== "following");
    expect(address(tab, { tab, cursor: "x" }).index).toBe(false);
  }
});

test("the head carries the title, description, canonical, robots and the card", () => {
  const head = homeMetadata({
    address: { path: "/?tab=hot", index: true },
    origin: "https://forum.example",
    siteName: "Garden Club",
    title: "Hot threads",
    description: "Hot on Garden Club.",
  });
  expect(head).toEqual({
    title: "Hot threads",
    description: "Hot on Garden Club.",
    alternates: { canonical: "https://forum.example/?tab=hot" },
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      title: "Hot threads - Garden Club",
      description: "Hot on Garden Club.",
      url: "https://forum.example/?tab=hot",
      siteName: "Garden Club",
    },
  });
});

test("a copy is noindex, follow, and points at its tab", () => {
  const head = homeMetadata({
    address: { path: "/", index: false },
    origin: "https://forum.example",
    siteName: "Garden Club",
    title: "t",
    description: "d",
  });
  expect(head.robots).toEqual({ index: false, follow: true });
  expect(head.alternates?.canonical).toBe("https://forum.example/");
});
