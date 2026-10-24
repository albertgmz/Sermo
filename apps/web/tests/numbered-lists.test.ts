import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (path: string) =>
  readFileSync(
    join(import.meta.dir, "..", "src/app/[locale]/(main)", path),
    "utf8",
  );

// The lists XenForo pages by number: the screen, the server action that draws a page for the
// in-place switch, and the part both draw (which holds the pagers).
const SCREENS = [
  [
    "a forum's threads",
    "forums/[id]/page.tsx",
    "forums/[id]/threads-page-action.tsx",
    "forums/[id]/thread-page.tsx",
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
] as const;

for (const [name, screen, action, region] of SCREENS) {
  test(`${name} turn their numbered pages in place, by the page's number in the address`, () => {
    const code = source(screen);
    expect(code).toContain("<PageSwitch");
    expect(code).toMatch(/load=\{\w+(\.bind\([^)]*\))?\}/);
    expect(code).toContain("pageParam(");
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
