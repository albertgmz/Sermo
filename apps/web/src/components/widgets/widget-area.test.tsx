import {
  afterAll,
  afterEach,
  beforeEach,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { WidgetPosition } from "@sermo/core/contracts";
import { renderToReadableStream } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { widgetBody } from "@/lib/test-bodies";
import { formattedTranslator, withIntl } from "@/lib/test-intl";
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
  getFormatter: async () => ({ number: (value: number) => String(value) }),
  getTranslations: async (namespace: string) => formattedTranslator(namespace),
}));
const intl = { ...(await import("next-intl")) };
const { useTranslations, useFormatter } = await import("use-intl");
mock.module("next-intl", () => ({
  ...intl,
  useLocale: () => "en",
  useTranslations,
  useFormatter,
}));

const { viewerOfRequest } = await import("@/lib/sermo/client");
const {
  DRAWN_PAGES,
  DRAWN_POSITIONS,
  WidgetArea,
  widgetAreas,
  widgetAside,
  widgetLead,
} = await import("./widget-area");

afterAll(() => {
  mock.module("next-intl/server", () => intlServer);
  mock.module("next-intl", () => intl);
});
// Another test file leaves a stand-in for the viewer in place: the widgets ask the backend.
beforeEach(() => {
  mock.module("@/lib/sermo/session", () => ({ getViewer: viewerOfRequest }));
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const titles = messages.widgets.widgetArea.titles;
const context = {
  params: {},
  widgets: [],
  href: (query: [string, string][]) =>
    `/?${new URLSearchParams(query).toString()}`,
};

const thread = (id: number, title: string) => ({
  id,
  nodeId: 2,
  node: { id: 2, title: "General" },
  title,
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
    postedAt: "2026-01-02T00:00:00.000Z",
    user: { id: 3, username: "member3" },
  },
  readPosition: null,
  isUnread: false,
  pollKind: null,
});

const memberCard = {
  card: {
    id: 7,
    username: "nova",
    avatar: null,
    frame: null,
    nameColor: null,
    nameIcon: null,
    title: "",
    badges: [],
    level: 1,
    restricted: false,
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  postCount: 0,
  reactionScore: 0,
  awardXp: 0,
  credits: 0,
  awardCount: 0,
  referralCount: 0,
};

const forum = (id: number, title: string) => ({
  id,
  parentId: null,
  type: "forum",
  title,
  description: "",
  icon: null,
  iconKey: null,
  cover: null,
  position: id,
  tabId: null,
  depth: 0,
  threadCount: 3,
  postCount: 0,
  lastPost: null,
  permissions: { canPost: true, canModerate: false },
  settings: {
    requireThreadApproval: false,
    requireReplyApproval: false,
    isReadOnly: false,
    countsPosts: true,
    minAccountAgeDays: 0,
    minPostCount: 0,
    requirePrefix: false,
  },
});

type Answer = (search: URLSearchParams) => Response;

// The ranked threads answer one thread named after the ranking asked for.
const rankings: Record<string, Answer> = {
  "/api/v1/thread-rankings": (search) =>
    Response.json({
      items: [
        thread(
          search.get("by") === "mostReacted" ? 10 : 11,
          `Thread by ${search.get("by")}`,
        ),
      ],
    }),
};

// Each read answers from `answers` by path, everything else with an empty list.
const asked: URLSearchParams[] = [];
function backend(answers: Record<string, Answer> = {}) {
  asked.length = 0;
  globalThis.fetch = (async (url: string) => {
    const { pathname, searchParams } = new URL(url);
    if (pathname === "/api/v1/me") return Response.json(viewerBody(false));
    if (pathname === "/api/v1/thread-rankings") asked.push(searchParams);
    const answer = answers[pathname];
    if (answer) return answer(searchParams);
    return Response.json({ items: [], nextCursor: null });
  }) as unknown as typeof fetch;
}

async function draw(node: React.ReactNode) {
  const errors: unknown[] = [];
  const stream = await renderToReadableStream(withIntl(node), {
    onError: (error) => {
      errors.push(error);
    },
  });
  await stream.allReady;
  return { html: await new Response(stream).text(), errors };
}

const area = (widgets: ReturnType<typeof widgetBody>[]) => (
  <WidgetArea widgets={widgets as never} context={context} />
);

const mostReacted = widgetBody({
  id: 1,
  position: "novedades_sidebar",
  type: "rankedThreads",
  options: { by: "mostReacted", limit: 5 },
});
const latest = widgetBody({
  id: 2,
  position: "novedades_sidebar",
  type: "rankedThreads",
  options: { by: "latestThreads", limit: 5 },
});
const members = widgetBody({
  id: 3,
  position: "novedades_sidebar",
  type: "suggestedMembers",
});
const forums = widgetBody({
  id: 4,
  position: "novedades_sidebar",
  type: "forumLinks",
  options: { limit: 1 },
});

test("the widgets are drawn in the order given, each under its type's title", async () => {
  backend({
    ...rankings,
    "/api/v1/members": () =>
      Response.json({ items: [memberCard], nextCursor: null }),
    "/api/v1/nodes": () =>
      Response.json({ items: [forum(5, "Garden"), forum(6, "Kitchen")] }),
  });
  const { html, errors } = await draw(
    area([forums, latest, mostReacted, members]),
  );
  expect(errors).toEqual([]);
  const at = (text: string) => html.indexOf(text);
  for (const title of [
    titles.forumLinks,
    titles.latestThreads,
    titles.mostReacted,
    titles.suggestedMembers,
  ])
    expect(at(title), title).toBeGreaterThan(-1);
  expect(at(titles.forumLinks)).toBeLessThan(at(titles.latestThreads));
  expect(at(titles.latestThreads)).toBeLessThan(at(titles.mostReacted));
  expect(at(titles.mostReacted)).toBeLessThan(at(titles.suggestedMembers));
  // The forum links take the widget's own limit.
  expect(html).toContain("Garden");
  expect(html).not.toContain("Kitchen");
});

test("a widget given a title shows it instead of its type's", async () => {
  backend(rankings);
  const { html } = await draw(
    area([{ ...mostReacted, title: "Hot right now" }]),
  );
  expect(html).toContain("Hot right now");
  expect(html).not.toContain(titles.mostReacted);
});

test("the ranked blocks ask for what the feed shows, by their own ranking and size", async () => {
  backend(rankings);
  await draw(
    area([
      mostReacted,
      { ...latest, options: { by: "latestThreads", limit: 3 } },
    ]),
  );
  expect(asked.map((query) => query.get("by")).sort()).toEqual([
    "latestThreads",
    "mostReacted",
  ]);
  expect(asked.every((query) => query.get("feed") === "true")).toBe(true);
  expect(asked.map((query) => query.get("limit")).sort()).toEqual(["3", "5"]);
});

test("a list by date says who and when; a ranking is numbered with replies and views", async () => {
  backend(rankings);
  const byDate = (await draw(area([latest]))).html;
  expect(byDate).toContain("member4");
  expect(byDate).not.toContain("4 replies");
  backend(rankings);
  const ranking = (await draw(area([mostReacted]))).html;
  expect(ranking).toContain("4 replies");
  expect(ranking).toContain("10 views");
});

test("a block with nothing to show draws nothing, not an empty frame", async () => {
  backend();
  const { html, errors } = await draw(area([mostReacted, latest, forums]));
  expect(errors).toEqual([]);
  expect(html).not.toContain("<section");
});

test("a viewer who may not list members gets no suggested members, and no error", async () => {
  backend({
    "/api/v1/members": () =>
      Response.json(
        { error: { code: "forbidden", message: "Not for you." } },
        { status: 403 },
      ),
  });
  const { html, errors } = await draw(area([members]));
  expect(errors).toEqual([]);
  expect(html).not.toContain(titles.suggestedMembers);
});

test("the suggested members are there when the backend lists them", async () => {
  backend({
    "/api/v1/members": () =>
      Response.json({ items: [memberCard], nextCursor: null }),
  });
  const { html } = await draw(area([members]));
  expect(html).toContain(titles.suggestedMembers);
  expect(html).toContain("nova");
});

test("a widget whose read fails draws nothing and is logged; the others are still drawn", async () => {
  const log = spyOn(console, "error").mockImplementation(() => {});
  backend({
    "/api/v1/members": () =>
      Response.json(
        { error: { code: "internal", message: "Broken." } },
        { status: 500 },
      ),
    ...rankings,
  });
  const { html, errors } = await draw(area([members, mostReacted]));
  const logged = log.mock.calls.map(([line]) => String(line));
  log.mockRestore();
  expect(errors).toEqual([]);
  expect(html).not.toContain(titles.suggestedMembers);
  expect(html).toContain(titles.mostReacted);
  expect(logged.some((line) => line.includes("suggestedMembers"))).toBe(true);
});

test("a widget of a type this app does not draw is left out", async () => {
  backend(rankings);
  const visitor = {
    ...widgetBody({
      id: 9,
      position: "novedades_sidebar",
      type: "featured",
    }),
    type: "somethingNew",
  };
  const { html, errors } = await draw(area([visitor as never, mostReacted]));
  expect(errors).toEqual([]);
  expect(html).toContain(titles.mostReacted);
});

test("a widget kept off phones is hidden there, and hides itself while empty", async () => {
  backend(rankings);
  const shown = (await draw(area([mostReacted]))).html;
  expect(shown).not.toContain("max-md:hidden");
  backend(rankings);
  const kept = (await draw(area([{ ...mostReacted, phones: false }]))).html;
  expect(kept).toMatch(
    /<div class="empty:hidden max-md:hidden"><!--\$--><section/,
  );
});

test("while a block loads its skeleton holds its place, under a label that names it", async () => {
  // The read never answers: the shell is all there is.
  globalThis.fetch = (async (url: string) =>
    new URL(url).pathname === "/api/v1/me"
      ? Response.json(viewerBody(false))
      : new Promise(() => {})) as unknown as typeof fetch;
  const controller = new AbortController();
  const stream = await renderToReadableStream(
    withIntl(area([{ ...forums, options: { limit: 4 } }])),
    { signal: controller.signal, onError: () => {} },
  );
  // Stopped once the shell is out: what is still loading keeps its fallback.
  controller.abort();
  const shell = await new Response(stream).text();
  expect(shell).toContain(`Loading “${titles.forumLinks}”…`);
  expect(shell.match(/flex h-11 items-center gap-3 px-4/g)).toHaveLength(4);
});

test("the areas of a page take its positions in order, and other pages' are left out", () => {
  const at = (
    id: number,
    position: Parameters<typeof widgetBody>[0]["position"],
  ) => widgetBody({ id, position, type: "featured" });
  const list = [
    at(1, "overview_top"),
    at(2, "forum_list_above"),
    at(3, "novedades_above"),
    at(4, "overview_bottom"),
    at(5, "forum_list_sidebar"),
    at(6, "novedades_sidebar"),
    at(7, "sidebar_top"),
    at(8, "sidebar_bottom"),
    at(9, "forum_list_below"),
  ] as never;
  const ids = (areas: Record<string, { id: number }[]>) =>
    Object.fromEntries(
      Object.entries(areas).map(([key, items]) => [
        key,
        items.map(({ id }) => id),
      ]),
    );
  expect(ids(widgetAreas("home", list))).toEqual({
    lead: [1],
    above: [2],
    below: [9, 4],
    aside: [7, 5, 8],
  });
  expect(ids(widgetAreas("novedades", list))).toEqual({
    lead: [1],
    above: [3],
    below: [4],
    aside: [7, 6, 8],
  });
});

test("the global sidebar positions open and close the sidebar, though the backend lists them last", () => {
  // widgets.current orders by position as `WIDGET_PAGE_POSITIONS` lists them, global ones last, and
  // then by display order.
  const at = (
    id: number,
    position: Parameters<typeof widgetBody>[0]["position"],
  ) => widgetBody({ id, position, type: "featured" });
  const backendOrder = [
    at(1, "forum_list_sidebar"),
    at(2, "forum_list_sidebar"),
    at(3, "sidebar_top"),
    at(4, "sidebar_top"),
    at(5, "sidebar_bottom"),
  ] as never;
  expect(widgetAreas("home", backendOrder).aside.map(({ id }) => id)).toEqual([
    3, 4, 1, 2, 5,
  ]);
});

test("a lead with no widget for phones is hidden there, so it leaves no gap", () => {
  expect(widgetLead([], context)).toEqual({});
  const top = widgetBody({ id: 1, position: "overview_top", type: "featured" });
  expect(widgetLead([top] as never, context).leadClassName).toBeUndefined();
  expect(
    widgetLead([{ ...top, phones: false }] as never, context).leadClassName,
  ).toBe("max-md:hidden");
});

test("the sidebar is no column when empty, and none on a phone when no widget in it is drawn there", () => {
  expect(widgetAside([], context)).toEqual({});
  const one = widgetAside([mostReacted] as never, context);
  expect(one.aside).toBeDefined();
  expect(one.asideClassName ?? "").not.toContain("max-md:hidden");
  const off = widgetAside(
    [
      { ...mostReacted, phones: false },
      { ...latest, phones: false },
    ] as never,
    context,
  );
  expect(off.asideClassName).toContain("max-md:hidden");
  const mixed = widgetAside(
    [{ ...mostReacted, phones: false }, latest] as never,
    context,
  );
  expect(mixed.asideClassName ?? "").not.toContain("max-md:hidden");
});

test("a widget of a type this app does not draw opens no column and no lead", () => {
  const at = (
    id: number,
    position: Parameters<typeof widgetBody>[0]["position"],
  ) => widgetBody({ id, position, type: "featured" });
  const undrawn = [
    { ...at(1, "overview_top"), type: "somethingNew" },
    { ...at(2, "sidebar_bottom"), type: "somethingElse" },
  ] as never;
  const areas = widgetAreas("home", undrawn);
  expect(areas.lead).toEqual([]);
  expect(areas.aside).toEqual([]);
  expect(widgetAside(areas.aside, context)).toEqual({});
});

test("each forum statistics widget keeps its open state apart, the first under the old name", async () => {
  const { ForumStatsWidget } = await import("./forum-stats-widget");
  const first = widgetBody({
    id: 1,
    position: "overview_top",
    type: "forumStats",
  });
  const second = widgetBody({
    id: 7,
    position: "forum_list_below",
    type: "forumStats",
  });
  const page = { ...context, widgets: [first, second] as never };
  const keyOf = (widget: typeof first) =>
    (
      ForumStatsWidget({
        widget: widget as never,
        title: "Statistics",
        context: page,
      }) as { props: { instance: number | null } }
    ).props.instance;
  expect(keyOf(first)).toBeNull();
  expect(keyOf(second)).toBe(7);
});

// The admin panel marks a position "not shown yet", and names the pages that show it, from these:
// they are what the areas of the two pages take widgets from, so a position added to an area is
// drawn there and in the panel's words.
test("the drawn positions are exactly those the areas of the pages take widgets from", () => {
  const everywhere = WidgetPosition.options.map((position, index) =>
    widgetBody({ id: index + 1, position, type: "forumLinks" }),
  ) as never;
  for (const page of ["home", "novedades"] as const) {
    const taken = Object.values(widgetAreas(page, everywhere)).flatMap((area) =>
      area.map((widget: { position: string }) => widget.position),
    );
    expect([...DRAWN_PAGES[page]].sort()).toEqual([...taken].sort());
  }
  expect([...DRAWN_POSITIONS].sort()).toEqual(
    [...new Set(Object.values(DRAWN_PAGES).flat())].sort(),
  );
});

test("only the home page and What's new draw the global sidebars, and no page draws the forum or members positions", () => {
  expect(Object.keys(DRAWN_PAGES)).toEqual(["home", "novedades"]);
  for (const position of ["sidebar_top", "sidebar_bottom"] as const) {
    expect(DRAWN_PAGES.home).toContain(position);
    expect(DRAWN_PAGES.novedades).toContain(position);
  }
  expect(DRAWN_POSITIONS).not.toContain("forum_view_sidebar");
  expect(DRAWN_POSITIONS).not.toContain("members_sidenav");
  expect(DRAWN_PAGES.home).not.toContain("novedades_sidebar");
  expect(DRAWN_PAGES.novedades).not.toContain("forum_list_sidebar");
});
