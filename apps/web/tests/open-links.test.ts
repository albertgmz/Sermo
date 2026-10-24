import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const MAIN = "src/app/[locale]/(main)";

// The lists whose links to a whole thread or conversation open where the reader left off. Each
// builds them with `lib/sermo/open-links`, never by writing `/threads/<id>` itself.
const LISTS = [
  `${MAIN}/forums/[id]/thread-row.tsx`,
  `${MAIN}/forums/forum-stats.tsx`,
  `${MAIN}/_feed/feed-item.tsx`,
  `${MAIN}/_feed/compact-item.tsx`,
  `${MAIN}/_feed/thread-title.tsx`,
  `${MAIN}/account/bookmarks/bookmark-page.tsx`,
  `${MAIN}/account/preferences/sections.tsx`,
  `${MAIN}/members/[id]/activity-page.tsx`,
  `${MAIN}/search/search-page.tsx`,
  "src/components/forum/conversation-preview.tsx",
  "src/lib/sermo/forums.ts",
];

test("every list of threads and conversations builds its links with the open-link helper", () => {
  for (const file of LISTS) {
    const source = readFileSync(file, "utf8");
    expect(source, file).toMatch(/\/open-links"/);
  }
});

test("no list writes a thread or conversation address of its own as a link", () => {
  const own = /href=\{`\/(threads|conversations)\/\$\{/;
  for (const file of LISTS) {
    expect(readFileSync(file, "utf8"), file).not.toMatch(own);
  }
});
