import { afterAll, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { translator, withIntl } from "@/lib/test-intl";
import { byMemberId } from "@/lib/test-members";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const intlServer = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, prefetch() {} }),
}));
// Another suite replaces the translator with one that fills no placeholders: use the real one.
const intl = { ...(await import("next-intl")) };
const { useTranslations, useFormatter } = await import("use-intl");
mock.module("next-intl", () => ({
  ...intl,
  useLocale: () => "en",
  useNow: () => new Date("2026-01-03T00:00:00.000Z"),
  useTranslations,
  useFormatter,
}));
afterAll(() => {
  mock.module("next-intl/server", () => intlServer);
  mock.module("next/navigation", () => navigation);
  mock.module("next-intl", () => intl);
});
const { ThreadRow } = await import("./thread-row");

const member = byMemberId((id: number) => ({
  id,
  username: `member${id}`,
  avatar: null,
  frame: null,
  nameColor: null,
  nameIcon: null,
  title: "",
  badges: [],
  level: 1,
  restricted: false,
}));

const thread = (pollKind: "poll" | "quiz" | null) =>
  ({
    id: 7,
    nodeId: 2,
    node: { id: 2, title: "General" },
    title: "A thread",
    prefix: null,
    excerpt: "",
    cover: null,
    highlightedUntil: null,
    bumpedAt: null,
    author: { id: 4, username: "member4" },
    state: "visible",
    isSticky: false,
    isLocked: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    replyCount: 4,
    viewCount: 10,
    firstPostId: 30,
    lastPost: {
      postId: 31,
      position: 4,
      postedAt: "2026-01-01T00:00:00.000Z",
      user: { id: 3, username: "member3" },
    },
    readPosition: null,
    isUnread: false,
    pollKind,
  }) as unknown as Parameters<typeof ThreadRow>[0]["thread"];

async function draw(node: ReactNode) {
  const stream = await renderToReadableStream(withIntl(node));
  await stream.allReady;
  return new Response(stream).text();
}

const row = (pollKind: "poll" | "quiz" | null, signedIn = false) =>
  draw(
    <ThreadRow
      thread={thread(pollKind)}
      member={member}
      highlighted={false}
      signedIn={signedIn}
    />,
  );

test("a thread with a poll or a quiz carries the badge in the forum's list", async () => {
  expect(await row("poll")).toContain("Poll");
  expect(await row("quiz")).toContain("Quiz");
  expect(await row(null)).not.toMatch(/>Poll<|>Quiz</);
});

test("a member's links to a thread open where they left off and a guest's open its start", async () => {
  const hrefs = (html: string) =>
    [...html.matchAll(/href="(\/threads\/[^"]*)"/g)].map((found) => found[1]);
  expect(new Set(hrefs(await row(null, true)))).toEqual(
    new Set(["/threads/7/unread"]),
  );
  expect(new Set(hrefs(await row(null, false)))).toEqual(
    new Set(["/threads/7"]),
  );
});

test("a thread of several pages links to its last pages beside the title, as XenForo's list does", async () => {
  const base = thread(null);
  const long = {
    ...base,
    lastPost: { ...base.lastPost, position: 64 },
  } as typeof base;
  const html = await draw(
    <ThreadRow thread={long} member={member} highlighted={false} signedIn />,
  );
  const hrefs = [...html.matchAll(/href="(\/threads\/[^"]*)"/g)].map(
    (found) => found[1],
  );
  // The title opens where the member left off; the page links open their page.
  expect(new Set(hrefs)).toEqual(
    new Set([
      "/threads/7/unread",
      "/threads/7?page=2",
      "/threads/7?page=3",
      "/threads/7?page=4",
    ]),
  );
  expect(html).toContain('aria-label="Page 4"');
  // A thread of one page has none.
  expect(await row(null, true)).not.toContain("?page=");
});

test("the last post stacks the time over the poster, both at the end of the cell, so a name is not cut beside the time", async () => {
  const html = await row(null);
  const cell = /<div class="hidden w-52[^"]*"[^>]*>(.*?)<\/div>/.exec(
    html,
  )?.[1];
  expect(cell).toBeDefined();
  // The time first, then the poster on a line of its own; no dot joins them.
  expect(cell).not.toContain("·");
  expect(cell?.indexOf("<time")).toBeLessThan(cell?.indexOf("member3") ?? -1);
  expect(cell).toMatch(/<\/time><span class="block[^"]*">.*member3/);
});

test("a thread started and last answered by guests shows them by name as guests, with no member link", async () => {
  const { membersFor } = await import("@/lib/sermo/members");
  const base = thread(null);
  const started = { kind: "guest", name: "Wanderer" } as const;
  const answered = { kind: "guest", name: null } as const;
  const guests = {
    ...base,
    author: started,
    lastPost: { ...base.lastPost, user: answered },
  } as unknown as typeof base;
  const html = await draw(
    <ThreadRow
      thread={guests}
      member={await membersFor([started, answered])}
      highlighted={false}
      signedIn={false}
    />,
  );
  const text = html.replace(/<[^>]*>/g, "");
  expect(text).toContain("Wanderer · Guest");
  expect(text).toMatch(/Guest(?! ·)/);
  expect(html).not.toContain("/members/");
});

test("a thread marked +18 carries the mark while the +18 mode is on; in its forum's own list only for its own mark", async () => {
  const { messages } = await import("@/i18n/messages");
  const name = messages.forum.adultBadge.name;
  const base = thread(null);
  const own = { ...base, isAdult: true, adultByForum: false } as typeof base;
  const byForum = {
    ...base,
    isAdult: false,
    adultByForum: true,
  } as typeof base;
  const drawn = (shown: typeof base, adultMode: boolean, showForum = false) =>
    draw(
      <ThreadRow
        thread={shown}
        member={member}
        highlighted={false}
        signedIn
        adultMode={adultMode}
        showForum={showForum}
      />,
    );
  expect(await drawn(own, true)).toContain(name);
  // The mode is off: marks are kept and change nothing.
  expect(await drawn(own, false)).not.toContain(name);
  // The forum's mark is on the forum's heading; a list of several forums puts it on the thread.
  expect(await drawn(byForum, true)).not.toContain(name);
  expect(await drawn(byForum, true, true)).toContain(name);
});
