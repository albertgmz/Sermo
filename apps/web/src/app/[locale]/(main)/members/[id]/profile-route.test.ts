import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// A member's page is a layout and a page per tab. The layout draws the header, the level strip and
// the tab bar; a tab pressed is a navigation that draws only the tab's page, so nothing the header
// needs is read or drawn by a page.

const here = import.meta.dir;
const read = (path: string) => readFileSync(join(here, path), "utf8");

const PAGES = [
  "page.tsx",
  "posts/page.tsx",
  "threads/page.tsx",
  "about/page.tsx",
];
const TABS = ["posts", "threads", "about"];

test("the layout draws the header, the level strip and the tab bar of the segments", () => {
  const layout = read("layout.tsx");
  expect(layout).toContain("<ProfileHeader");
  expect(layout).toContain("<LevelStrip");
  expect(layout).toContain("<SegmentTabLinks");
  // Every link in the profile keeps the `[id]` as the address spelled it (see `profileAddress`).
  expect(layout).toContain("const address = profileAddress(id);");
  expect(layout).toContain("tabs={profileTabLinks(");
  expect(layout).not.toContain("canonical");
});

test("no page draws or reads what the header shows", () => {
  for (const page of PAGES) {
    const code = read(page);
    expect(code, page).not.toMatch(
      /profile-header|segment-tab-links|LevelStrip|activitiesFor|relationsFor|memberAdminTabs/,
    );
  }
});

test("each tab has its own placeholder, of the tab only", () => {
  for (const loading of [
    "loading.tsx",
    ...TABS.map((tab) => `${tab}/loading.tsx`),
  ]) {
    expect(existsSync(join(here, loading)), loading).toBe(true);
    expect(read(loading), loading).not.toMatch(
      /ProfileHeaderSkeleton|TabsSkeleton/,
    );
  }
});

test("the wall alone carries the profile's structured data", () => {
  expect(read("page.tsx")).toContain("<JsonLd");
  for (const tab of TABS)
    expect(read(`${tab}/page.tsx`)).not.toContain("JsonLd");
});

test("nothing in the profile links to a tab by the query or changes a tab in place", () => {
  const sources = (dir: string): string[] =>
    readdirSync(join(here, dir), { withFileTypes: true }).flatMap((entry) => {
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) return sources(path);
      return /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)
        ? [path]
        : [];
    });
  for (const file of sources("")) {
    const code = read(file);
    expect(code, file).not.toMatch(/[?&]tab=|TabSwitch|goInPlace/);
  }
});
