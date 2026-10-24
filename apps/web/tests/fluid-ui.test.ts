import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// What changes part of a page changes only that part. A link to the same page with another query
// (a tab, a filter, the next page of a list) is a navigation: the route's `loading.tsx` takes the
// place of the whole page until the new one is drawn. So every tab bar is drawn inside a
// `TabSwitch` (or links to pages of their own, said here), every "Load more" link is listed with
// why it may load a page, and every redraw of a whole page after an action is listed with why the
// action needs it. A new one fails here until it is made in place, or listed with its reason.

const root = join(import.meta.dir, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

function sources(dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap(
    (entry) => {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return sources(path);
      return /\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)
        ? [path]
        : [];
    },
  );
}

const files = sources("src");
const using = (pattern: RegExp) =>
  files.filter((file) => pattern.test(read(file))).sort();

const MAIN = "src/app/[locale]/(main)";

// Each file that draws a tab bar: the file that draws the `TabSwitch` it is in (it draws the bar's
// file, or is it), or why the bar's links may open pages.
const TAB_BARS: Record<string, { switch: string } | { pages: string }> = {
  [`${MAIN}/members/[id]/sections.tsx`]: {
    switch: `${MAIN}/members/[id]/page.tsx`,
  },
  [`${MAIN}/novedades/feed-column.tsx`]: {
    switch: `${MAIN}/novedades/page.tsx`,
  },
  [`${MAIN}/forums/forum-list.tsx`]: {
    switch: `${MAIN}/forums/forum-list.tsx`,
  },
  [`${MAIN}/forums/forum-stats.tsx`]: {
    switch: `${MAIN}/forums/forum-stats.tsx`,
  },
  [`${MAIN}/members/directory.tsx`]: {
    switch: `${MAIN}/members/members-view.tsx`,
  },
  [`${MAIN}/credits/content.tsx`]: { switch: `${MAIN}/credits/page.tsx` },
  // The styleguide's samples link to `#`.
  [`${MAIN}/ui/page.tsx`]: { pages: "styleguide samples" },
  // Each tab is a screen of its own, at its own path: the staff panel's layout stays, the screen's
  // own placeholder shows while it loads, as for any other page.
  "src/app/[locale]/(staff)/admin/settings/settings-screen.tsx": {
    pages: "a settings screen per tab",
  },
  "src/app/[locale]/(staff)/admin/users/[id]/member-tabs.tsx": {
    pages: "a member screen per tab",
  },
};

// Each file with a "Load more" link (a navigation to the list's next page), and why.
const LOAD_MORE: Record<string, string> = {
  // The conversation's earlier and newer messages: its own pages, which get the numbered pager.
  [`${MAIN}/conversations/[id]/page.tsx`]: "the conversation's own pages",
  // Inside the credits page's switch, which owns its lists' cursors: the next page of a list comes
  // in place.
  [`${MAIN}/credits/inventory.tsx`]: "in the credits switch",
};

// Each file that draws a whole page again after something the visitor did (or on a timer), and
// why. None of them is a navigation: Next draws the page again in a transition, with no
// placeholder, and the lists keep the pages and the place they hold.
const REDRAWS: Record<string, string> = {
  // The header's counts, the avatar and the balance are drawn by the layout, on every page.
  [`${MAIN}/account/picture-row.tsx`]: "the avatar is everywhere",
  "src/app/account/picture/route.ts": "the avatar is everywhere",
  [`${MAIN}/account/actions.ts`]: "the profile and appearance are everywhere",
  [`${MAIN}/credits/actions.ts`]: "the balance and what is worn",
  [`${MAIN}/upgrade/actions.ts`]: "the rank is everywhere",
  [`${MAIN}/notifications/mark-all-read.tsx`]: "every row and the counts",
  [`${MAIN}/notifications/notification-link.tsx`]: "the header's counts",
  [`${MAIN}/conversations/[id]/conversation-sync.tsx`]: "the header's counts",
  [`${MAIN}/conversations/[id]/mark-read-button.tsx`]: "the header's counts",
  [`${MAIN}/conversations/actions.ts`]: "the list and the header's counts",
  "src/app/[locale]/(staff)/admin/appearance/actions.ts": "the site's look",
  "src/app/[locale]/(staff)/admin/forums/actions.ts": "the public forum tree",
  // The devices of this browser, which only the server can tell apart.
  [`${MAIN}/account/notifications/push-devices.tsx`]: "the device list",
  [`${MAIN}/account/api/actions.ts`]: "the new key is shown once",
  // A forum hidden from the feed leaves every page of it.
  "src/components/forum/feed-filters-popup.tsx": "forums hidden in the sheet",
  "src/components/forum/hide-forum-button.tsx": "a forum hidden from a card",
  // The thread changed under the page (a merge moved posts).
  "src/components/forum/live-tail.tsx": "the thread was reshaped",
  "src/components/staff/refresh-while.tsx": "a staff screen that waits",
  "src/components/layout/cookie-consent-root.tsx": "embeds follow the consent",
  // Notices, terms, a status and a reply from the feed change the layout or lead to the thread.
  [`${MAIN}/actions.ts`]: "notices, terms, a reply from the feed",
  "src/components/layout/status-action.ts": "the status is in the header",
  "src/lib/sermo/outcome.ts": "the acceptance or approval notice",
  // Writes whose result is drawn in more than one place on the page (a post and its thread's
  // counts, a wall item and its post's comment count, a forum's marks in every list).
  [`${MAIN}/forums/actions.ts`]: "watching, marks read, moderation",
  [`${MAIN}/members/actions.ts`]: "wall comments, edits and deletions",
  [`${MAIN}/threads/actions.ts`]: "replies, edits, tags, deletions",
  [`${MAIN}/threads/polls-actions.ts`]: "the poll and its thread",
};

test("every tab bar is drawn in a switch that changes it in place, or says why its tabs open pages", () => {
  const bars = using(/<TabLinks\b/);
  expect(bars).toEqual(Object.keys(TAB_BARS).sort());
  for (const [bar, where] of Object.entries(TAB_BARS)) {
    if (!("switch" in where)) continue;
    const code = read(where.switch);
    expect(code, where.switch).toMatch(/<TabSwitch\b/);
    expect(code, where.switch).toMatch(/\bparams=\{/);
    expect(code, where.switch).toContain("stamp={Date.now()}");
    // The switch draws the bar's file, or is it.
    if (where.switch !== bar) {
      const module = bar.replace(/^src\//, "@/").replace(/\.tsx?$/, "");
      expect(code, `${where.switch} draws ${bar}`).toContain(`"${module}"`);
    }
  }
});

test("each switch asks the server for what it shows through a server action", () => {
  for (const file of using(/<TabSwitch\b/)) {
    const code = read(file);
    const loader = /<TabSwitch[\s\S]*?\bload=\{(\w+)/.exec(code)?.[1];
    expect(loader, file).toBeDefined();
    const from = new RegExp(
      `import \\{[^}]*\\b${loader}\\b[^}]*\\} from "@/([^"]+)"`,
    ).exec(code)?.[1];
    expect(from, `${file}: ${loader}`).toBeDefined();
    const path = [".ts", ".tsx"]
      .map((ending) => `src/${from}${ending}`)
      .find((candidate) => existsSync(join(root, candidate)));
    expect(path, `${file}: ${from}`).toBeDefined();
    expect(read(path ?? "").startsWith('"use server";'), path).toBe(true);
  }
});

test("every Load more link that opens the list's next page as a page is listed with its reason", () => {
  expect(using(/<LoadMore\b/)).toEqual(Object.keys(LOAD_MORE).sort());
});

test("every redraw of a whole page after an action is listed with its reason", () => {
  const redraws = using(
    /router\.refresh[(;]|^\s*refresh\(\);|revalidatePath\("\/", "layout"\)|revalidatePath\("\/\[locale\]\/\w+", "layout"\)/m,
  );
  expect(redraws).toEqual(Object.keys(REDRAWS).sort());
});

// Who reacted is read when its popover opens, by an action that only reads: an action that wrote a
// cookie, revalidated or refreshed would have Next draw the whole page again under the popover.
test("the list of who reacted is read by an action that draws nothing else again", () => {
  const action = read("src/components/forum/reaction-users-action.tsx");
  expect(action.startsWith('"use server";')).toBe(true);
  expect(action).not.toMatch(
    /\brefresh\(|revalidate|redirect\(|cookies\(\)|updateTag/,
  );
  const list = read("src/components/forum/reaction-users.tsx");
  expect(list).not.toMatch(/useRouter|router\./);
});
