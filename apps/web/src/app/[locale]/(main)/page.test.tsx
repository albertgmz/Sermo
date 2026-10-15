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
import { translator, withIntl } from "@/lib/test-intl";
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
const { default: HomePage } = await import("./page");

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
}: {
  member: boolean;
  siteTab?: string;
  own?: string | null;
  siteFails?: boolean;
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
      return Response.json(body);
    }
    if (pathname === "/api/v1/site/home-tab")
      return siteFails
        ? Response.json({ error: { code: "internal" } }, { status: 500 })
        : Response.json({ tab: siteTab });
    return Response.json({ items: [], nextCursor: null });
  }) as unknown as typeof fetch;
}

async function render(searchParams: Record<string, string> = {}) {
  const stream = await renderToReadableStream(
    withIntl(
      <HomePage
        params={Promise.resolve({ locale: "en" })}
        searchParams={Promise.resolve(searchParams)}
      />,
    ),
    { onError: () => {} },
  );
  await stream.allReady;
  return new Response(stream).text();
}

const FEED = "/api/v1/feed";
const MEDIA = "/api/v1/media";
// Only the forum list asks for the section tabs (the side column also reads the forums).
const FORUMS = "/api/v1/forum-tabs";
const SITE_TAB = "/api/v1/site/home-tab";

test("with no tab in the address the site's default opens", async () => {
  backend({ member: false, siteTab: "forums" });
  await render();
  expect(paths()).toContain(SITE_TAB);
  expect(paths()).toContain(FORUMS);
  expect(paths()).not.toContain(FEED);
});

test("a member's own choice opens without asking the site, and beats its default", async () => {
  backend({ member: true, siteTab: "forums", own: "media" });
  await render();
  expect(paths()).not.toContain(SITE_TAB);
  expect(paths()).toContain(MEDIA);
  expect(paths()).not.toContain(FORUMS);
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
  expect(html).toContain('href="/?tab=hot"');
});

test("the featured threads and the wall composer are asked for on the feed tabs only", async () => {
  const FEATURED = "/api/v1/featured-threads";
  backend({ member: true });
  await render({ tab: "hot" });
  expect(paths()).toContain(FEATURED);
  for (const tab of ["forums", "media"]) {
    backend({ member: true });
    await render({ tab });
    expect(paths(), tab).not.toContain(FEATURED);
  }
});

test("a tab in the address wins over the choice and the default", async () => {
  backend({ member: true, siteTab: "forums", own: "media" });
  await render({ tab: "hot" });
  const feed = asked.find((entry) => entry.path === FEED);
  expect(feed?.search.get("scope")).toBe("hot");
  expect(paths()).not.toContain(MEDIA);
  expect(paths()).not.toContain(FORUMS);
});

test("each tab has a stable address that opens it", async () => {
  backend({ member: true });
  await render({ tab: "media" });
  expect(paths()).toContain(MEDIA);
  backend({ member: true });
  await render({ tab: "forums" });
  expect(paths()).toContain(FORUMS);
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
  expect(html).not.toContain('href="/?tab=following"');
});

test("the bar shows three tabs and the rest are in a More menu; the open tab is always shown", async () => {
  backend({ member: true });
  const html = await render({ tab: "media" });
  const bar = (tab: string) => html.includes(`href="/?tab=${tab}"`);
  // Latest and Hot stay, Media takes the place of the last one; Following and Forums are behind
  // the menu, which is closed.
  expect([bar("latest"), bar("hot"), bar("media")]).toEqual([true, true, true]);
  expect([bar("following"), bar("forums")]).toEqual([false, false]);
  expect(html).toContain(">More<");
});
