import {
  afterAll,
  afterEach,
  beforeEach,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { WHATS_NEW_WIDGETS, widgetBody } from "@/lib/test-bodies";
import { translator, withIntl } from "@/lib/test-intl";
import { withQuery } from "@/lib/test-query";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));

const { viewerOfRequest } = await import("@/lib/sermo/client");
const { default: WhatsNewPage } = await import("./page");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next/cache", () => nextCache);
});
// Another test file leaves a stand-in for the viewer in place: the page asks the backend.
beforeEach(() => {
  mock.module("@/lib/sermo/session", () => ({ getViewer: viewerOfRequest }));
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const asked: { path: string; search: URLSearchParams }[] = [];
const paths = () => asked.map((entry) => entry.path);

// The viewer, the tab the site gives, and empty lists for everything else.
function backend({
  member,
  siteTab = "latest",
  own = null,
  siteFails = false,
  canPost = false,
  widgets = WHATS_NEW_WIDGETS,
}: {
  member: boolean;
  siteTab?: string;
  own?: string | null;
  siteFails?: boolean;
  canPost?: boolean;
  widgets?: unknown[];
}) {
  asked.length = 0;
  globalThis.fetch = (async (url: string) => {
    const { pathname, searchParams } = new URL(url);
    asked.push({ path: pathname, search: searchParams });
    if (pathname === "/api/v1/me") {
      const body = viewerBody(member);
      // The backend decides the member's default: their choice, else the site's answer.
      if (body.user)
        Object.assign(body.user, { homeTab: own, openHomeTab: own ?? siteTab });
      body.permissions.canPostProfile = canPost;
      return Response.json(body);
    }
    if (pathname === "/api/v1/widgets")
      return Response.json({ items: widgets });
    if (pathname === "/api/v1/site/home-tab")
      return siteFails
        ? Response.json({ error: { code: "internal" } }, { status: 500 })
        : Response.json({ tab: siteTab });
    return Response.json({ items: [], nextCursor: null });
  }) as unknown as typeof fetch;
}

async function render(searchParams: Record<string, string> = {}) {
  const stream = await renderToReadableStream(
    withQuery(
      withIntl(
        <WhatsNewPage
          params={Promise.resolve({ locale: "en" })}
          searchParams={Promise.resolve(searchParams)}
        />,
      ),
    ),
    { onError: () => {} },
  );
  await stream.allReady;
  return new Response(stream).text();
}

const FEED = "/api/v1/feed";
const MEDIA = "/api/v1/media";
const SITE_TAB = "/api/v1/site/home-tab";

test("with no tab in the address the site's default opens", async () => {
  backend({ member: false, siteTab: "media" });
  await render();
  expect(paths()).toContain(SITE_TAB);
  expect(paths()).toContain(MEDIA);
  expect(paths()).not.toContain(FEED);
});

test("a member's own choice opens without asking the site, and beats its default", async () => {
  backend({ member: true, siteTab: "hot", own: "media" });
  await render();
  expect(paths()).not.toContain(SITE_TAB);
  expect(paths()).toContain(MEDIA);
  expect(paths()).not.toContain(FEED);
});

test("a member with no choice gets the default the backend decided for them, with no extra request", async () => {
  backend({ member: true, siteTab: "hot" });
  await render();
  expect(paths()).not.toContain(SITE_TAB);
  const feed = asked.find((entry) => entry.path === FEED);
  expect(feed?.search.get("scope")).toBe("hot");
});

test("a guest whose default cannot be read gets Latest, not an error page", async () => {
  const log = spyOn(console, "error").mockImplementation(() => {});
  backend({ member: false, siteFails: true });
  const html = await render();
  log.mockRestore();
  expect(asked.find((entry) => entry.path === FEED)?.search.get("scope")).toBe(
    "latest",
  );
  expect(html).toContain('href="/whats-new?tab=hot"');
});

test("the featured threads and the wall composer are asked for on the feed tabs only", async () => {
  const FEATURED = "/api/v1/featured-threads";
  backend({ member: true });
  await render({ tab: "hot" });
  expect(paths()).toContain(FEATURED);
  backend({ member: true });
  await render({ tab: "media" });
  expect(paths()).not.toContain(FEATURED);
});

test("the page asks for its own widgets, and draws the featured threads only when one is placed", async () => {
  const FEATURED = "/api/v1/featured-threads";
  backend({ member: true });
  await render({ tab: "latest" });
  expect(
    asked.find((entry) => entry.path === "/api/v1/widgets")?.search.get("page"),
  ).toBe("whats_new");
  backend({ member: true, widgets: [] });
  const html = await render({ tab: "latest" });
  expect(paths()).not.toContain(FEATURED);
  expect(html).not.toContain("<aside");
});

test("a forum statistics widget keeps the open tab and its filter on its tab links, and opens the tab asked for", async () => {
  backend({
    member: true,
    widgets: [
      widgetBody({ id: 9, position: "overview_top", type: "forumStats" }),
    ],
  });
  const html = await render({
    tab: "hot",
    forums: "3",
    stats: "viewed",
    cursor: "abc",
  });
  expect(html).toContain(
    'href="/whats-new?tab=hot&amp;forums=3&amp;stats=threads"',
  );
  // The first statistics tab is the bare address of the view.
  expect(html).toContain('href="/whats-new?tab=hot&amp;forums=3"');
  const rankings = asked.filter(
    (entry) => entry.path === "/api/v1/thread-rankings",
  );
  expect(rankings.map((entry) => entry.search.get("by"))).toContain(
    "mostViewed",
  );
});

test("the side blocks are drawn below the feed on phones, not hidden there", async () => {
  backend({ member: true });
  const html = await render({ tab: "latest" });
  const aside = html.match(/<aside class="([^"]*)"/)?.[1] ?? "";
  expect(aside.split(" ")).toContain("grid");
  expect(aside).not.toContain("hidden");
  expect(paths()).toContain("/api/v1/thread-rankings");
});

test("a tab in the address wins over the choice and the default", async () => {
  backend({ member: true, siteTab: "latest", own: "media" });
  await render({ tab: "hot" });
  const feed = asked.find((entry) => entry.path === FEED);
  expect(feed?.search.get("scope")).toBe("hot");
  expect(paths()).not.toContain(MEDIA);
});

test("each tab has a stable address that opens it", async () => {
  backend({ member: true });
  await render({ tab: "media" });
  expect(paths()).toContain(MEDIA);
  backend({ member: true });
  await render({ tab: "following" });
  expect(asked.find((entry) => entry.path === FEED)?.search.get("scope")).toBe(
    "following",
  );
});

test("a guest who asks for following, or whose default is it, gets latest", async () => {
  backend({ member: false });
  await render({ tab: "following" });
  expect(asked.find((entry) => entry.path === FEED)?.search.get("scope")).toBe(
    "latest",
  );
  backend({ member: false, siteTab: "following" });
  const html = await render();
  expect(asked.find((entry) => entry.path === FEED)?.search.get("scope")).toBe(
    "latest",
  );
  expect(html).not.toContain('href="/whats-new?tab=following"');
});

// The two bars of the page: the phone's, hidden from `md`, and the wider screens', hidden below it.
function bars(html: string) {
  const navs = [
    ...html.matchAll(
      /<nav aria-label="What&#x27;s new tabs" class="([^"]*)">([\s\S]*?)<\/nav>/g,
    ),
  ];
  const of = (name: string) =>
    navs.find(([, names]) => names.split(" ").includes(name))?.[2] ?? "";
  return { phone: of("md:hidden"), wide: of("max-md:hidden") };
}
const linked = (bar: string) =>
  [...bar.matchAll(/href="\/whats-new\?tab=(\w+)"/g)].map(([, tab]) => tab);

test("the bar shows three tabs and the rest are in a More menu; the open tab is always shown", async () => {
  backend({ member: true });
  const html = bars(await render({ tab: "media" })).wide;
  const bar = (tab: string) => html.includes(`href="/whats-new?tab=${tab}"`);
  // Latest and Hot stay, Media takes the place of the last one; Following is behind the menu,
  // which is closed.
  expect([bar("latest"), bar("hot"), bar("media")]).toEqual([true, true, true]);
  expect(bar("following")).toBe(false);
  expect(html).toContain(">More<");
});

test("a filter in the address narrows the feed and is shown as chips that take each field off", async () => {
  backend({ member: true });
  const html = await render({
    tab: "latest",
    forums: "3,4",
    prefix: "2",
    type: "sticky",
    tag: "rust",
    watched: "1",
    unread: "1",
  });
  const feed = asked.find((entry) => entry.path === FEED);
  expect(feed?.search.get("scope")).toBe("latest");
  expect(feed?.search.getAll("forumIds")).toEqual(["3", "4"]);
  expect(feed?.search.get("prefixId")).toBe("2");
  expect(feed?.search.get("type")).toBe("sticky");
  expect(feed?.search.get("tag")).toBe("rust");
  expect(feed?.search.get("watched")).toBe("true");
  expect(feed?.search.get("unread")).toBe("true");
  // Forum and prefix names come from their own reads, made because the filter has them.
  expect(paths()).toContain("/api/v1/thread-prefixes");
  expect(html).toContain("Filters (7)");
  // Each chip leads to the same view without its field.
  expect(html).toContain(
    'href="/whats-new?tab=latest&amp;forums=3%2C4&amp;prefix=2&amp;type=sticky&amp;watched=1&amp;unread=1"',
  );
  expect(html).toContain(
    'href="/whats-new?tab=latest&amp;forums=4&amp;prefix=2&amp;type=sticky&amp;tag=rust&amp;watched=1&amp;unread=1"',
  );
  expect(html).toContain('href="/whats-new?tab=latest"');
  expect(html).toContain("No threads match these filters");
});

test("without a filter the bar is a button only, and nothing more is read for it", async () => {
  backend({ member: true });
  const html = await render({ tab: "latest" });
  expect(html).toContain(">Filters<");
  expect(paths()).not.toContain("/api/v1/thread-prefixes");
  expect(paths()).not.toContain("/api/v1/feed/options");
  expect(html).not.toContain("Clear filters");
  expect(
    asked.find((entry) => entry.path === FEED)?.search.has("forumIds"),
  ).toBe(false);
});

test("a filter that is malformed is dropped, and the other tabs have no filter bar", async () => {
  backend({ member: true });
  await render({ tab: "latest", forums: "x,y", type: "pinned", watched: "0" });
  const feed = asked.find((entry) => entry.path === FEED);
  expect([...(feed?.search.keys() ?? [])].sort()).toEqual(["scope"]);
  backend({ member: true });
  expect(await render({ tab: "media", unread: "1" })).not.toContain(
    "Feed filters",
  );
});

test("the featured block is not drawn above a list a filter narrowed", async () => {
  const FEATURED = "/api/v1/featured-threads";
  backend({ member: true });
  await render({ tab: "latest" });
  expect(paths()).toContain(FEATURED);
  backend({ member: true });
  await render({ tab: "latest", type: "locked" });
  expect(paths()).not.toContain(FEATURED);
});

test("a first page with no row and a cursor to go on says so above the button, not a blank list", async () => {
  backend({ member: true });
  const answer = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (new URL(url).pathname === FEED)
      return Response.json({ items: [], nextCursor: "abc" });
    return answer(url, init);
  }) as unknown as typeof fetch;
  const html = await render({ tab: "latest", unread: "1" });
  expect(html).toContain("Press the button to keep looking");
  expect(html).not.toContain("No threads match these filters");
  expect(html).toContain("cursor=abc");
});

test("a member's phone bar holds Latest, Trending and Following, with Media in More", async () => {
  backend({ member: true, siteTab: "hot" });
  const { phone, wide } = bars(await render());
  expect(linked(phone)).toEqual(["latest", "hot", "following"]);
  expect(phone).toContain(">More<");
  expect(linked(wide)).toEqual(["latest", "hot", "following"]);
});

test("a guest's phone bar has no Following", async () => {
  backend({ member: false });
  const { phone, wide } = bars(await render());
  expect(linked(phone)).toEqual(["latest", "hot"]);
  expect(linked(wide)).toEqual(["latest", "hot", "media"]);
});

test("on a phone Media open is on the bar and there is no More", async () => {
  backend({ member: true });
  const { phone } = bars(await render({ tab: "media" }));
  expect(linked(phone)).toEqual(["latest", "hot", "following", "media"]);
  expect(phone).not.toContain("<button");
});

test("every tab of the phone bar shows its word, as the wider bar does: no icon stands in for one", async () => {
  backend({ member: true });
  const { phone, wide } = bars(await render({ tab: "hot" }));
  const links = [...phone.matchAll(/<a [^>]*>(.*?)<\/a>/g)].map(
    ([, inner]) => inner,
  );
  expect(links).toEqual(["Latest", "Trending", "Following"]);
  // The menu at the end says "More" too.
  expect(phone).toContain(">More<");
  expect(phone).not.toContain("sr-only");
  expect(wide).not.toMatch(/<a [^>]*><svg/);
  expect(wide).toContain(">Trending<");
});

test("the wall composer is not drawn below md, where the + of the bottom bar posts", async () => {
  backend({ member: true, canPost: true });
  const html = await render({ tab: "latest" });
  const composer = html.match(/<section aria-label="New post" class="([^"]*)"/);
  expect(composer?.[1].split(" ")).toContain("max-md:hidden");
});

test("the tab labels are short in English and Spanish", async () => {
  const en = (await import("../../../../../messages/en/home.json")).default;
  const es = (await import("../../../../../messages/es/home.json")).default;
  const labels = (tabs: Record<string, string>) =>
    ["latest", "hot", "following", "media"].map((tab) => tabs[tab]);
  expect(labels(en.page.tabs)).toEqual([
    "Latest",
    "Trending",
    "Following",
    "Media",
  ]);
  expect(labels(es.page.tabs)).toEqual([
    "Recientes",
    "Tendencias",
    "Siguiendo",
    "Multimedia",
  ]);
});
