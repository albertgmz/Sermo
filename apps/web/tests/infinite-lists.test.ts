import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (path: string) =>
  readFileSync(join(import.meta.dir, "..", "src", path), "utf8");

const SCREENS = [
  ["feed", "app/[locale]/(main)/novedades/page.tsx", "_feed/feed-actions.ts"],
  [
    "forum thread lists",
    "app/[locale]/(main)/forums/[id]/page.tsx",
    "forums/[id]/more-threads.ts",
  ],
  [
    "conversations",
    "app/[locale]/(main)/conversations/page.tsx",
    "conversations/more-conversations.ts",
  ],
  [
    "search results",
    "app/[locale]/(main)/search/results.tsx",
    "search/more-results.ts",
  ],
  [
    "profile activity",
    "app/[locale]/(main)/members/[id]/activity.tsx",
    "members/[id]/more-activity.ts",
  ],
  [
    "bookmarks",
    "app/[locale]/(main)/account/bookmarks/bookmark-list.tsx",
    "account/bookmarks/more-bookmarks.ts",
  ],
  [
    "notifications",
    "app/[locale]/(main)/notifications/page.tsx",
    "notifications/more-notifications.ts",
  ],
  [
    "award holders",
    "app/[locale]/(main)/awards/[id]/page.tsx",
    "awards/[id]/more-holders.ts",
  ],
  [
    "credits history",
    "app/[locale]/(main)/credits/history.tsx",
    "credits/more-history.ts",
  ],
  [
    "member rankings and the month's standing",
    "app/[locale]/(main)/members/page.tsx",
    "members/more-members.ts",
  ],
  [
    "member directory",
    "app/[locale]/(main)/members/directory.tsx",
    "members/more-members.ts",
  ],
] as const;

// The pager of these screens is the one shared list: a screen that still draws its own link to
// the next page, or reads the page count from nowhere, has drifted from it.
for (const [name, screen, action] of SCREENS) {
  test(`${name} draw their list through the shared paged list`, () => {
    const code = source(screen);
    // Directly, or in a card with a heading over it (`PagedCard`, which draws one).
    expect(code).toMatch(/<Paged(List|Card)/);
    expect(code).not.toContain("LoadMore");
    expect(code).toMatch(
      /pages=\{pagesParam\(|pages=\{pages\}|pages=\{Math\.min\(pages,/,
    );
    expect(code).toMatch(/more=\{more\w+(\.bind\([^)]*\))?\}/);
  });

  test(`${name} ask for the pages after the first through a server action`, () => {
    const code = readFileSync(
      join(
        import.meta.dir,
        "..",
        "src/app/[locale]/(main)",
        action.replace(/^app\/\[locale\]\/\(main\)\//, ""),
      ),
      "utf8",
    );
    expect(code.startsWith('"use server";')).toBe(true);
    // A stale cursor or an ended session ends the list; it is no 404 or sign-in page mid-scroll.
    expect(code).toMatch(/endQuietly|endsTheList/);
    expect(code).not.toContain("read(");
  });
}

test("the shared list keeps the place in the address and takes its first page from the server", () => {
  const list = source("components/forum/infinite-list.tsx");
  expect(list).toContain("useListPlace(");
  // Through the browser's own method: Next's replaces `history.replaceState`, and a call to it
  // throws away a navigation in flight.
  const place = source("components/forum/list-place.ts");
  expect(place).toContain("placeHref(");
  expect(place).toContain("writePlace(window.history");
  expect(`${list}${place}`).not.toContain("history.replaceState");
  // Nothing is fetched on mount: the server's pages are the data and it never goes stale.
  expect(list).toContain("initialData");
  expect(list).toContain("staleTime: Number.POSITIVE_INFINITY");
  // The next page loads on a press only: nothing watches the scroll to load it.
  expect(list).not.toContain("IntersectionObserver");
  expect(list).toContain("useWindowVirtualizer");
  expect(list).toContain("measureElement");
});

// The forum page reads its prefix filter from the address with this pattern.
test("the forum page takes a prefix id of any length from the address", () => {
  const code = source("app/[locale]/(main)/forums/[id]/page.tsx");
  expect(code).toContain("/^[1-9]\\d*$/.test(prefix");
});

test("the query client is set up once, in the root layout", () => {
  expect(source("app/[locale]/layout.tsx")).toContain("<QueryProvider>");
  const uses = ["components/forum/infinite-list.tsx"];
  for (const path of uses)
    expect(source(path)).not.toContain("new QueryClient");
});
