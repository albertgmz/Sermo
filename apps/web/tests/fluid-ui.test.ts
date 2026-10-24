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
  [`${MAIN}/online/online-section.tsx`]: { switch: `${MAIN}/online/page.tsx` },
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
  // Inside the credits page's switch, which owns its lists' cursors: the next page of a list comes
  // in place.
  [`${MAIN}/credits/inventory.tsx`]: "in the credits switch",
};

// Each file that draws a whole page again after something the visitor did (or on a timer), and
// why its change cannot be drawn by the element alone. None of them is a navigation: Next draws the
// page again in a transition (in the action's own answer for `refresh()` and `revalidatePath`),
// with no placeholder, the scroll position kept, and the shared lists keep the pages and the place
// they hold. What changes only one element is drawn by it instead (a reaction, a bookmark, a
// follow, the badges after an alert is read, the feed after a forum is hidden, a purchase's
// notice).
const REDRAWS: Record<string, string> = {
  // A new avatar is drawn by the server everywhere it shows: the header's menu (the layout), the
  // member's posts, cards and rows on the page. Nothing in the browser holds it.
  [`${MAIN}/account/picture-row.tsx`]: "the avatar in the layout and posts",
  "src/app/account/picture/route.ts": "the avatar in the layout and posts",
  // Profile, appearance and preferences change the name, colour, frame and settings the layout and
  // every page draw; the forms save and show the page again with their notice, as XenForo does.
  [`${MAIN}/account/actions.ts`]: "the member's look and settings, everywhere",
  // A purchase changes the balance in the header, the item's card and the inventory: drawn again in
  // the action's answer, with its notice said in place (no redirect).
  [`${MAIN}/credits/actions.ts`]: "the balance in the header, cards, inventory",
  [`${MAIN}/upgrade/actions.ts`]: "the rank in the header, ladder and posts",
  // Every row of the list changes (read), with the counts.
  [`${MAIN}/notifications/mark-all-read.tsx`]: "every row of the list",
  // The conversation's own read state, its list and the counts (the conversations' screen).
  [`${MAIN}/conversations/[id]/conversation-sync.tsx`]: "the conversation read",
  [`${MAIN}/conversations/[id]/mark-read-button.tsx`]: "the conversation read",
  [`${MAIN}/conversations/actions.ts`]: "the conversation and its list",
  "src/app/[locale]/(staff)/admin/appearance/actions.ts": "the site's look",
  "src/app/[locale]/(staff)/admin/forums/actions.ts": "the public forum tree",
  // The devices of this browser's member, which only the server can tell apart.
  [`${MAIN}/account/notifications/push-devices.tsx`]: "the device list",
  [`${MAIN}/account/api/actions.ts`]: "the new key is shown once",
  // Outside the feed's switch (a card on a profile), the page is drawn again; inside, the feed is.
  "src/components/forum/feed-filters-popup.tsx": "the feed, outside its switch",
  "src/components/forum/hide-forum-button.tsx": "the feed, outside its switch",
  // The thread changed under the page (a merge moved posts).
  "src/components/forum/live-tail.tsx": "the thread was reshaped",
  "src/components/staff/refresh-while.tsx": "a staff screen that waits",
  // Scripts and embeds across the page follow the consent.
  "src/components/layout/cookie-consent-root.tsx": "embeds follow the consent",
  // A notice dismissed and the terms accepted change the layout; a reply from the feed goes to
  // the thread.
  [`${MAIN}/actions.ts`]: "notices, terms, a reply from the feed",
  // A status from the header's menu is a wall post: the wall and the feed behind the menu list it.
  "src/components/layout/status-action.ts": "the wall and the feed list it",
  // The acceptance or approval notice is the layout's.
  "src/lib/sermo/outcome.ts": "the acceptance or approval notice",
  // A forum watched or marked read changes its marks in every list on the page; moderation moves
  // threads between lists.
  [`${MAIN}/forums/actions.ts`]: "watching, marks read, moderation",
  // A wall comment is drawn in its post's block and the post's count, on the wall, in the feed and
  // in a picture's viewer; the composer lands on it. Edits and deletions likewise.
  [`${MAIN}/members/actions.ts`]: "wall comments, edits and deletions",
  // Replies, edits, deletions and moderation change the post, the thread's counts and its pages.
  [`${MAIN}/threads/actions.ts`]: "replies, edits, tags, deletions",
  [`${MAIN}/threads/polls-actions.ts`]: "the poll and its thread",
};

// The forum's actions that open the page they were on again, with a notice in its address: a
// navigation, which puts the route's placeholder over the page. Each is a settings form saved
// (XenForo shows the page again with its notice) or leaves the page.
const NOTICE_REDIRECTS: Record<string, string> = {
  [`${MAIN}/account/actions.ts`]: "account settings saved",
  [`${MAIN}/account/api/actions.ts`]: "an API key revoked",
  [`${MAIN}/account/security/actions.ts`]:
    "sessions, password, email, account deleted",
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

// Each file that draws a forum's prefix filter (a `PrefixSelect` whose choices are links to the
// list narrowed to one prefix), with the file that draws the `TabSwitch` it is in.
const PREFIX_FILTERS: Record<string, string> = {
  [`${MAIN}/forums/[id]/forum-threads.tsx`]: `${MAIN}/forums/[id]/page.tsx`,
};

test("every prefix filter of links is drawn in a switch that narrows the list in place", () => {
  expect(using(/<PrefixSelect\b[^>]*?\bhrefs=/)).toEqual(
    Object.keys(PREFIX_FILTERS).sort(),
  );
  for (const [filter, where] of Object.entries(PREFIX_FILTERS)) {
    const code = read(where);
    expect(code, where).toMatch(/<TabSwitch\b/);
    expect(code, where).toContain('params={["prefix"]}');
    expect(code, where).toContain("stamp={Date.now()}");
    const module = filter.replace(/^src\//, "@/").replace(/\.tsx?$/, "");
    expect(code, `${where} draws ${filter}`).toContain(`"${module}"`);
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

// A list's "Load more" link names the list's place in full (`?tab=latest&cursor=…`), which a switch
// around it would otherwise read as another tab when the address names none.
test("a switch leaves a list's Load more to the list", () => {
  expect(read("src/components/forum/infinite-list.tsx")).toContain(
    "data-list-more",
  );
  expect(read("src/components/forum/tab-switch.tsx")).toContain(
    'link.closest("[data-list-more]")',
  );
});

test("every action of the forum that opens its page again with a notice is listed with its reason", () => {
  const redirecting = files
    .filter((file) => file.startsWith(`${MAIN}/`))
    .filter((file) => {
      const code = read(file);
      return /redirect\(/.test(code) && /[?&]notice=/.test(code);
    })
    .sort();
  expect(redirecting).toEqual(Object.keys(NOTICE_REDIRECTS).sort());
});

// A purchase, a rank bought and a wall comment change what is on the page where it is: the action
// answers in place (a notice to say, a comment to land on) and opens no address.
test("the shop's, the ranks' and the wall comment's actions open no page", () => {
  for (const file of [
    `${MAIN}/credits/actions.ts`,
    `${MAIN}/upgrade/actions.ts`,
  ])
    expect(read(file), file).not.toMatch(/redirect\(/);
  const members = read(`${MAIN}/members/actions.ts`);
  const comment = members.slice(
    members.indexOf("export async function commentOnWallPost("),
    members.indexOf("export type WallItemKind"),
  );
  expect(comment).not.toMatch(/redirect\(/);
});
