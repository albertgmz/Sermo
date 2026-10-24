import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (path: string) =>
  readFileSync(
    join(import.meta.dir, "..", "src/app/[locale]/(main)", path),
    "utf8",
  );

// The lists XenForo pages by number: the screen, the server action that draws a page for the
// in-place switch, the part both draw (which holds the pagers), and the file that reads the page
// from the address when that is not the screen (a view of the members section gets it as a prop).
const SCREENS = [
  [
    "a forum's threads",
    "forums/[id]/forum-threads.tsx",
    "forums/[id]/threads-page-action.tsx",
    "forums/[id]/thread-page.tsx",
    "forums/[id]/page.tsx",
  ],
  [
    "a tag's threads",
    "tags/[name]/page.tsx",
    "tags/[name]/threads-page-action.tsx",
    "tags/[name]/tag-page.tsx",
  ],
  [
    "the conversations",
    "conversations/page.tsx",
    "conversations/conversations-page-action.tsx",
    "conversations/conversation-page.tsx",
  ],
  [
    "a conversation's messages",
    "conversations/[id]/page.tsx",
    "conversations/[id]/messages-page.tsx",
    "conversations/[id]/messages-region.tsx",
  ],
  [
    "the search results",
    "search/results.tsx",
    "search/search-page-action.tsx",
    "search/search-page.tsx",
    "search/page.tsx",
  ],
  [
    "a member's posts and threads",
    "members/[id]/activity.tsx",
    "members/[id]/activity-page-action.tsx",
    "members/[id]/activity-page.tsx",
    "members/[id]/page.tsx",
  ],
  [
    "the bookmarks",
    "account/bookmarks/bookmark-list.tsx",
    "account/bookmarks/bookmarks-page-action.tsx",
    "account/bookmarks/bookmark-page.tsx",
  ],
  [
    "the alerts",
    "notifications/page.tsx",
    "notifications/notifications-page-action.tsx",
    "notifications/notification-page.tsx",
  ],
  [
    "the member directory",
    "members/directory.tsx",
    "members/members-page-actions.tsx",
    "members/directory-page.tsx",
    "members/members-view.tsx",
  ],
] as const satisfies readonly (readonly [string, ...string[]])[];

for (const [name, screen, action, region, address = screen] of SCREENS) {
  test(`${name} turn their numbered pages in place, by the page's number in the address`, () => {
    const code = source(screen);
    expect(code).toContain("<PageSwitch");
    expect(code).toMatch(/load=\{\w+(\.bind\([^)]*\))?\}/);
    expect(source(address)).toContain("pageParam(");
    // A page past the last goes to the last, as XenForo does.
    expect(code).toMatch(/redirect\(\s*pageAddress\(/);
    // No list of the old kind is left beside it.
    expect(code).not.toMatch(/PagedList|LoadMore|cursor=/);
  });

  test(`${name} draw a page for the switch through a server action, null when it cannot`, () => {
    const code = source(action);
    expect(code.startsWith('"use server";')).toBe(true);
    expect(code).toContain("requireIds(");
    expect(code).toContain("drawnOrNull(");
    expect(code).not.toContain("read(");
  });

  test(`${name} draw their pagers as plain links in the part that turns`, () => {
    expect(source(region)).toMatch(/<(NumberedList|PageNav)\b/);
  });
}

// The rankings share a file with the month's standing, which still loads more: only the ranking's
// own view is checked.
test("the member rankings turn their numbered pages in place, by the page's number in the address", () => {
  const code = source("members/members-view.tsx");
  const ranking = code.slice(
    code.indexOf("async function RankingView"),
    code.indexOf("async function StaffView"),
  );
  expect(ranking).toContain("<PageSwitch");
  expect(ranking).toMatch(/load=\{rankingPageAction\.bind\(/);
  expect(ranking).toMatch(/redirect\(\s*pageAddress\(/);
  expect(ranking).not.toMatch(/PagedList|LoadMore|cursor/);
  expect(code).toContain("pageParam(");
  expect(source("members/ranking-page.tsx")).toMatch(/<NumberedList\b/);
});
