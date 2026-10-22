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
import { siteBody, widgetBody } from "@/lib/test-bodies";
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
const { default: Loading } = await import("./loading");

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

const asked: string[] = [];
const widgetsAsked: (string | null)[] = [];

// The statistics panel above the forum list, as a new site places it.
const STATS = widgetBody({
  id: 1,
  position: "forum_list_above",
  type: "forumStats",
});

// A site with no forums and no ranked threads, with the widgets given: only the panel's own frame
// can show.
function backend(widgets: unknown[], member = false) {
  asked.length = 0;
  widgetsAsked.length = 0;
  globalThis.fetch = (async (url: string) => {
    const { pathname, searchParams } = new URL(url);
    asked.push(pathname);
    if (pathname === "/api/v1/me") return Response.json(viewerBody(member));
    if (pathname === "/api/v1/site") return Response.json(siteBody());
    if (pathname === "/api/v1/forum-tabs")
      return Response.json({
        items: [
          {
            id: 1,
            title: "Main",
            position: 0,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      });
    if (pathname === "/api/v1/widgets") {
      widgetsAsked.push(searchParams.get("page"));
      return Response.json({ items: widgets });
    }
    return Response.json({ items: [], nextCursor: null });
  }) as unknown as typeof fetch;
}

// What the page drew; what failed while drawing it is kept in `failed`.
const failed: unknown[] = [];
async function html(node: React.ReactNode) {
  failed.length = 0;
  const stream = await renderToReadableStream(withIntl(node), {
    onError: (error) => {
      failed.push(error);
    },
  });
  await stream.allReady;
  return new Response(stream).text();
}

const page = async (searchParams: Record<string, string> = {}) =>
  html(
    await HomePage({
      params: Promise.resolve({ locale: "en" }),
      searchParams: Promise.resolve(searchParams),
    }),
  );

// The panel's own tab link: other suites replace the interface text, never an address.
const panel = 'href="/?stats=threads"';
const RANKINGS = "/api/v1/thread-rankings";

test("without a statistics widget the panel is left out, and its threads are not asked for", async () => {
  backend([]);
  expect(await page()).not.toContain(panel);
  expect(asked).not.toContain(RANKINGS);
  expect(widgetsAsked).toEqual(["home"]);
});

test("the statistics widget draws the panel above the categories", async () => {
  backend([STATS]);
  const text = await page();
  expect(text).toContain(panel);
  expect(asked).toContain(RANKINGS);
  expect(text.indexOf(panel)).toBeLessThan(text.indexOf(">Main<"));
});

test("the loading skeleton asks the backend nothing: the widgets are the visitor's", async () => {
  backend([STATS]);
  await html(<Loading />);
  expect(asked).toEqual([]);
});

test("with no sidebar widget the page has no sidebar column", async () => {
  backend([STATS]);
  const text = await page();
  expect(text).not.toContain("<aside");
  expect(text).not.toContain("lg:grid-cols-[minmax(0,1fr)_var(--aside-width)]");
});

test("a sidebar widget opens the sidebar, drawn below the content on phones", async () => {
  backend([
    widgetBody({ id: 4, position: "forum_list_sidebar", type: "featured" }),
  ]);
  const text = await page();
  expect(text).toContain("lg:grid-cols-[minmax(0,1fr)_var(--aside-width)]");
  const aside = text.match(/<aside class="([^"]*)"/)?.[1] ?? "";
  expect(aside.split(" ")).toContain("grid");
  expect(aside).not.toContain("hidden");
});

test("a widgets read that fails leaves the forum list drawn, without widgets", async () => {
  const log = spyOn(console, "error").mockImplementation(() => {});
  backend([STATS]);
  const answer = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) =>
    new URL(url).pathname === "/api/v1/widgets"
      ? Response.json(
          { error: { code: "internal", message: "Broken." } },
          { status: 500 },
        )
      : answer(url, init)) as unknown as typeof fetch;
  const text = await page();
  log.mockRestore();
  expect(text).toContain(">Main<");
  expect(text).not.toContain(panel);
  expect(text).not.toContain("<aside");
});

test("a lead widget spans both columns above them", async () => {
  backend([
    widgetBody({ id: 5, position: "overview_top", type: "forumStats" }),
  ]);
  const text = await page();
  const lead = text.indexOf("lg:col-span-full");
  expect(lead).toBeGreaterThan(-1);
  expect(text.indexOf(panel)).toBeGreaterThan(lead);
  expect(text.indexOf(panel)).toBeLessThan(text.indexOf(">Main<"));
});

test("a section of the list keeps its statistics tab in the home page's own address", async () => {
  backend([STATS]);
  expect(await page({ section: "5" })).toContain(
    'href="/?section=5&amp;stats=threads"',
  );
});

test("the home page is the forum list, with the sign-in hero for a guest only", async () => {
  const hero = 'href="/register"';
  backend([]);
  expect(await page()).toContain(hero);
  backend([], true);
  const member = await page();
  expect(member).not.toContain(hero);
  expect(member).toContain('<h1 class="sr-only">Forums</h1>');
  // The feed is a page of its own.
  expect(asked).not.toContain("/api/v1/feed");
});

test("the site's structured data is on the plain home address only", async () => {
  backend([]);
  expect(await page()).toContain('"@type":"WebSite"');
  expect(await page({ utm_source: "x" })).toContain('"@type":"WebSite"');
  expect(await page({ section: "5" })).not.toContain('"@type":"WebSite"');
  expect(await page({ notice: "accountDeleted" })).not.toContain(
    '"@type":"WebSite"',
  );
});

test("the line a deleted account lands on is shown for that notice only", async () => {
  backend([]);
  const line = "Your account was deleted and you were signed out.";
  expect(await page({ notice: "accountDeleted" })).toContain(line);
  expect(await page()).not.toContain(line);
  expect(await page({ notice: "other" })).not.toContain(line);
});

test("a sign-out the backend could not make lands on a line that says so, for that notice only", async () => {
  backend([], true);
  const line = "You could not be signed out just now. Try again in a moment.";
  expect(await page({ notice: "signOutFailed" })).toContain(line);
  expect(await page({ notice: "accountDeleted" })).not.toContain(line);
  expect(await page({ notice: "toString" })).not.toContain(line);
});

test("two statistics widgets keep their own tab in the address", async () => {
  backend([
    STATS,
    widgetBody({ id: 7, position: "forum_list_below", type: "forumStats" }),
  ]);
  const text = await page({ "stats-7": "viewed" });
  // The first keeps the address the forum list has always used; the second is named after itself.
  expect(text).toContain('href="/?stats=threads"');
  expect(text).toContain('href="/?stats-7=threads"');
  const rankings: string[] = [];
  const answer = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const { pathname, searchParams } = new URL(url);
    if (pathname === RANKINGS) rankings.push(searchParams.get("by") ?? "");
    return answer(url, init);
  }) as unknown as typeof fetch;
  await page({ "stats-7": "viewed" });
  expect(rankings.sort()).toEqual(["latestPosts", "mostViewed"]);
});

test("a statistics read that fails leaves the panel without rows, logged, and the page standing", async () => {
  const log = spyOn(console, "error").mockImplementation(() => {});
  backend([STATS]);
  const answer = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) =>
    new URL(url).pathname === RANKINGS
      ? Response.json(
          { error: { code: "internal", message: "Broken." } },
          { status: 500 },
        )
      : answer(url, init)) as unknown as typeof fetch;
  const text = await page();
  const logged = log.mock.calls.map(([line]) => String(line));
  log.mockRestore();
  expect(failed).toEqual([]);
  expect(text).toContain(panel);
  expect(text).toContain(">Main<");
  expect(logged.some((line) => line.includes("forum statistics rows"))).toBe(
    true,
  );
});
