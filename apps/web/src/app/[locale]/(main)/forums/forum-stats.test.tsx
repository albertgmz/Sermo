import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { translator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;

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
// Another suite replaces the translator with one that fills no placeholders: use the real one.
const intl = { ...(await import("next-intl")) };
const { useTranslations, useFormatter } = await import("use-intl");
mock.module("next-intl", () => ({
  ...intl,
  useLocale: () => "en",
  useNow: () => new Date(),
  useTranslations,
  useFormatter,
}));
afterAll(() => {
  mock.module("next-intl/server", () => intlServer);
  mock.module("next-intl", () => intl);
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const { ForumStats } = await import("./forum-stats");

const card = (id: number, username: string) => ({
  id,
  username,
  avatar: null,
  frame: null,
  nameColor: null,
  nameIcon: null,
  title: "",
  badges: [],
  level: 1,
  restricted: false,
});

const thread = (
  id: number,
  title: string,
  authorId: number,
  isUnread = false,
) => ({
  id,
  nodeId: 2,
  node: { id: 2, title: "Deportes" },
  title,
  prefix: null,
  excerpt: "",
  cover: null,
  highlightedUntil: null,
  bumpedAt: null,
  author: { id: authorId, username: `member${authorId}` },
  state: "visible",
  isSticky: false,
  isLocked: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  replyCount: 949,
  viewCount: 23_700,
  firstPostId: 30,
  lastPost: {
    postId: 31,
    position: 4,
    postedAt: "2026-01-02T00:00:00.000Z",
    user: { id: 3, username: "member3" },
  },
  readPosition: null,
  isUnread,
  pollKind: null,
});

const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();

type Answer = (search: URLSearchParams) => Response;

const refused = () =>
  Response.json(
    { error: { code: "forbidden", message: "No." } },
    { status: 403 },
  );

// Three threads: one unread by member 4, seen 14 minutes ago (online); one read by member 5, seen
// 16 minutes ago (offline); one by member 6, who hides their online status, so the backend leaves
// them out of the list.
const DEFAULT: Record<string, Answer> = {
  "/api/v1/thread-rankings": () =>
    Response.json({
      items: [
        thread(10, "Unread thread", 4, true),
        thread(11, "Read one", 5),
        thread(12, "Hidden status", 6),
      ],
    }),
  "/api/v1/members/recently-active": () =>
    Response.json({
      total: 2,
      items: [
        { card: card(4, "member4"), lastActivityAt: minutesAgo(14) },
        { card: card(5, "member5"), lastActivityAt: minutesAgo(16) },
      ],
    }),
  "/api/v1/members": () =>
    Response.json({
      items: [
        {
          card: card(8, "clau92"),
          createdAt: "2026-01-01T00:00:00.000Z",
          postCount: 9838,
          reactionScore: 0,
          awardXp: 0,
          credits: 0,
          awardCount: 0,
          referralCount: 0,
        },
      ],
      nextCursor: null,
    }),
};

// Each read answers from `answers` by path (then the defaults), everything else with an empty list.
const asked = new Map<string, URLSearchParams>();
function backend(answers: Record<string, Answer> = {}) {
  asked.clear();
  globalThis.fetch = (async (url: string) => {
    const { pathname, searchParams } = new URL(url);
    asked.set(pathname, searchParams);
    if (pathname === "/api/v1/me" && !answers[pathname])
      return Response.json(viewerBody(true));
    const answer = answers[pathname] ?? DEFAULT[pathname];
    if (answer) return answer(searchParams);
    return Response.json({ items: [], nextCursor: null });
  }) as unknown as typeof fetch;
}

async function panel(topPosters = false, active = "posts") {
  const stream = await renderToReadableStream(
    withIntl(
      <ForumStats
        title="Forum statistics"
        limit={10}
        topPosters={topPosters}
        active={active as "posts"}
        hrefFor={(tab) => `/?stats=${tab}`}
        instance={null}
      />,
    ),
  );
  await stream.allReady;
  return new Response(stream).text();
}

// The row of a thread, from its `<li` to the next.
function rowOf(html: string, title: string) {
  const at = html.indexOf(title);
  const start = html.lastIndexOf("<li", at);
  return html.slice(start, html.indexOf("</li>", at));
}

// The title link of a thread.
function titleOf(html: string, title: string) {
  const at = html.indexOf(title);
  return html.slice(html.lastIndexOf("<a", at), html.indexOf("</a>", at));
}

test("the tab lists what the feed shows, ten threads by default", async () => {
  backend();
  await panel();
  const search = asked.get("/api/v1/thread-rankings");
  expect(search?.get("by")).toBe("latestPosts");
  expect(search?.get("feed")).toBe("true");
  expect(search?.get("limit")).toBe("10");
});

test("an unread thread's title is bold; a member's links open where they left off, read or not", async () => {
  backend();
  const html = await panel();
  const unread = titleOf(html, "Unread thread");
  expect(unread).toContain('href="/threads/10/unread"');
  expect(unread).toContain("font-bold");
  expect(unread).toMatch(/class="sr-only"> \((<!-- -->)?Unread/);
  const read = titleOf(html, "Read one");
  expect(read).toContain('href="/threads/11/unread"');
  expect(read).not.toContain("font-bold");
});

test("a guest's links open the thread at its start", async () => {
  backend({
    "/api/v1/me": () => Response.json(viewerBody(false)),
  });
  const html = await panel();
  expect(titleOf(html, "Unread thread")).toContain('href="/threads/10"');
  expect(titleOf(html, "Read one")).toContain('href="/threads/11"');
});

// The unread label is absolutely placed: without a positioned link it sits at the end of the
// uncut title, outside the truncation, and a long title widens the whole page on a phone.
test("the cut title holds its unread label inside the link", async () => {
  backend();
  const html = await panel();
  const opening = titleOf(html, "Unread thread").slice(0, 400);
  expect(opening).toMatch(/class="[^"]*\brelative\b[^"]*\btruncate\b/);
});

test("each row is one line whose columns leave as the panel narrows, the title last", async () => {
  backend();
  const row = rowOf(await panel(), "Read one");
  // The forum, the last poster, the figures, then the date and the rank, by the panel's width.
  for (const shown of ["@md:flex", "@xl:flex", "@2xl:flex", "@3xl:flex"])
    expect(row).toContain(shown);
  expect(row).toContain(">Deportes<");
  expect(row).toContain(">949<");
  expect(row).toContain(">23.7K<");
  expect(row).toContain("truncate");
});

test("the starter's avatar is marked online when they were seen in the last 15 minutes, offline otherwise", async () => {
  backend();
  const html = await panel();
  const online = rowOf(html, "Unread thread");
  expect(online).toContain("bg-success");
  expect(online).toContain(">Online<");
  const offline = rowOf(html, "Read one");
  expect(offline).toContain("bg-destructive");
  expect(offline).not.toContain("bg-success");
  expect(offline).not.toContain(">Online<");
});

test("a member who hides their online status is left out of the list by the backend, and reads offline", async () => {
  backend();
  const hidden = rowOf(await panel(), "Hidden status");
  expect(hidden).toContain("bg-destructive");
  expect(hidden).not.toContain("bg-success");
});

test("each tab asks for its own ranking, and an unknown tab is the first", async () => {
  const { STATS_TABS } = await import("./forum-stats");
  const expected = {
    posts: "latestPosts",
    threads: "latestThreads",
    replied: "mostReplied",
    reacted: "mostReacted",
    viewed: "mostViewed",
  };
  expect(STATS_TABS.map((tab) => tab.value)).toEqual(
    Object.keys(expected) as never,
  );
  for (const [active, by] of Object.entries(expected)) {
    backend();
    const html = await panel(false, active);
    expect(asked.get("/api/v1/thread-rankings")?.get("by")).toBe(by);
    expect(html).toMatch(
      new RegExp(
        `href="/\\?stats=${active}"[^>]*aria-current="page"|aria-current="page"[^>]*href="/\\?stats=${active}"`,
      ),
    );
  }
  backend();
  await panel(false, "nope");
  expect(asked.get("/api/v1/thread-rankings")?.get("by")).toBe("latestPosts");
});

test("the three most tabs say they cover the threads active in the last 30 days", async () => {
  for (const active of ["replied", "reacted", "viewed"]) {
    backend();
    expect(await panel(false, active)).toContain("in the last 30 days.");
  }
  for (const active of ["posts", "threads"]) {
    backend();
    expect(await panel(false, active)).not.toContain("in the last 30 days");
  }
  backend();
  expect(await panel(false, "reacted")).toContain(
    "Most reactions on the first post",
  );
});

test("a visitor who may not see who is online gets no marks at all, rather than everyone offline", async () => {
  backend({ "/api/v1/members/recently-active": refused });
  const html = await panel();
  expect(html).not.toContain("bg-destructive");
  expect(html).not.toContain("bg-success");
  expect(html).toContain("Read one");
});

test("a presence read that fails leaves the rows without marks, logged", async () => {
  const log = spyOn(console, "error").mockImplementation(() => {});
  backend({
    "/api/v1/members/recently-active": () =>
      Response.json({ error: { code: "internal" } }, { status: 500 }),
  });
  const html = await panel();
  const logged = log.mock.calls.map(([line]) => String(line));
  log.mockRestore();
  expect(html).toContain("Read one");
  expect(html).not.toContain("bg-destructive");
  expect(logged.some((line) => line.includes("members online"))).toBe(true);
});

test("the panel is open until the visitor closes it, on phones too", async () => {
  backend();
  const html = await panel();
  expect(html).not.toContain("hidden md:block");
  expect(html).toContain('aria-controls="');
});

test("the tabs carry their icons and the strip its scroll arrow, hidden until the strip overflows", async () => {
  backend();
  const html = await panel();
  expect(html).toMatch(/<a[^>]*href="\/\?stats=viewed"[^>]*><svg/);
  expect(html).toMatch(/<button[^>]*aria-hidden="true"[^>]*hidden=""/);
});

test("without the top posters option there is no column and no member list read", async () => {
  backend();
  const html = await panel(false);
  expect(html).not.toContain("Most messages");
  expect(asked.has("/api/v1/members")).toBe(false);
});

test("the top posters column lists the members with most messages, where the panel is wide", async () => {
  backend();
  const html = await panel(true);
  const search = asked.get("/api/v1/members");
  expect(search?.get("sort")).toBe("posts");
  expect(search?.get("limit")).toBe("10");
  expect(html).toContain("Most messages");
  expect(html).toContain(">clau92<");
  expect(html).toContain("9,838");
  expect(html).toMatch(/<section class="hidden[^"]*@6xl:block/);
});

test("a visitor who may not see the member list gets no top posters column", async () => {
  backend({ "/api/v1/members": refused });
  const html = await panel(true);
  expect(html).not.toContain("Most messages");
  expect(html).toContain("Read one");
});

test("the widget draws the top posters column when its option says so", async () => {
  const { ForumStatsWidget } = await import(
    "@/components/widgets/forum-stats-widget"
  );
  const { widgetBody } = await import("@/lib/test-bodies");
  const drawn = (topPosters: boolean) => {
    const widget = widgetBody({
      id: 1,
      position: "forum_list_above",
      type: "forumStats",
      options: { limit: 10, topPosters },
    });
    return (
      ForumStatsWidget({
        widget: widget as never,
        title: "Forum statistics",
        context: { params: {}, widgets: [widget as never], href: () => "/" },
      }) as { props: { topPosters: boolean } }
    ).props.topPosters;
  };
  expect(drawn(true)).toBe(true);
  expect(drawn(false)).toBe(false);
});

test("the top posters are read only where the panel can span the page", async () => {
  const { spansPage } = await import("@/components/widgets/forum-stats-widget");
  const { widgetBody } = await import("@/lib/test-bodies");
  const stats = (position: string) =>
    widgetBody({ id: 1, position: position as never, type: "forumStats" });
  const side = widgetBody({
    id: 2,
    position: "forum_list_sidebar",
    type: "forumLinks",
  });
  const on = (widget: ReturnType<typeof stats>, others: unknown[] = []) =>
    spansPage(widget as never, [widget, ...others] as never);
  // The lead spans both columns, whatever the sidebar holds.
  expect(on(stats("overview_top"), [side])).toBe(true);
  // The main column spans the page only when no sidebar opens beside it.
  expect(on(stats("forum_list_above"))).toBe(true);
  expect(on(stats("forum_list_above"), [side])).toBe(false);
  expect(
    on(stats("novedades_above"), [
      widgetBody({ id: 3, position: "sidebar_bottom", type: "forumLinks" }),
    ]),
  ).toBe(false);
  // A sidebar is never wide enough.
  expect(on(stats("novedades_sidebar"))).toBe(false);
  expect(on(stats("sidebar_top"))).toBe(false);
});

test("the statistics at the top of the home page span the page, so they show the top posters", async () => {
  const { spansPage } = await import("@/components/widgets/forum-stats-widget");
  const { widgetBody } = await import("@/lib/test-bodies");
  const stats = widgetBody({
    id: 1,
    position: "forum_list_top",
    type: "forumStats",
  });
  const side = widgetBody({
    id: 2,
    position: "forum_list_sidebar",
    type: "forumLinks",
  });
  expect(spansPage(stats as never, [stats, side] as never)).toBe(true);
});
