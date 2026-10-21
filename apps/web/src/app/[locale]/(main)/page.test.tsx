import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { siteBody } from "@/lib/test-bodies";
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

// A site with no forums and no ranked threads: only the panel's own frame can show.
function backend(forumStatsEnabled: boolean, member = false) {
  asked.length = 0;
  globalThis.fetch = (async (url: string) => {
    const { pathname } = new URL(url);
    asked.push(pathname);
    if (pathname === "/api/v1/me") return Response.json(viewerBody(member));
    if (pathname === "/api/v1/site")
      return Response.json(siteBody({ forumStatsEnabled }));
    return Response.json({ items: [], nextCursor: null });
  }) as unknown as typeof fetch;
}

async function html(node: React.ReactNode) {
  const stream = await renderToReadableStream(withIntl(node), {
    onError: () => {},
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

test("the statistics panel is left out, and its threads are not asked for, while the setting is off", async () => {
  backend(false);
  expect(await page()).not.toContain(panel);
  expect(asked).not.toContain(RANKINGS);
});

test("the statistics panel is drawn when the setting is on", async () => {
  backend(true);
  expect(await page()).toContain(panel);
  expect(asked).toContain(RANKINGS);
});

test("the loading skeleton holds the panel's place only when the setting is on", async () => {
  backend(false);
  const without = await html(await Loading());
  backend(true);
  const withPanel = await html(await Loading());
  expect(withPanel.length).toBeGreaterThan(without.length);
});

test("a section of the list keeps its statistics tab in the home page's own address", async () => {
  backend(true);
  expect(await page({ section: "5" })).toContain(
    'href="/?section=5&amp;stats=threads"',
  );
});

test("the home page is the forum list, with the sign-in hero for a guest only", async () => {
  const hero = 'href="/register"';
  backend(false);
  expect(await page()).toContain(hero);
  backend(false, true);
  const member = await page();
  expect(member).not.toContain(hero);
  expect(member).toContain('<h1 class="sr-only">Forums</h1>');
  // The feed is a page of its own.
  expect(asked).not.toContain("/api/v1/feed");
});

test("the site's structured data is on the plain home address only", async () => {
  backend(false);
  expect(await page()).toContain('"@type":"WebSite"');
  expect(await page({ utm_source: "x" })).toContain('"@type":"WebSite"');
  expect(await page({ section: "5" })).not.toContain('"@type":"WebSite"');
  expect(await page({ notice: "accountDeleted" })).not.toContain(
    '"@type":"WebSite"',
  );
});

test("the line a deleted account lands on is shown for that notice only", async () => {
  backend(false);
  const line = "Your account was deleted and you were signed out.";
  expect(await page({ notice: "accountDeleted" })).toContain(line);
  expect(await page()).not.toContain(line);
  expect(await page({ notice: "other" })).not.toContain(line);
});

test("a sign-out the backend could not make lands on a line that says so, for that notice only", async () => {
  backend(false, true);
  const line = "You could not be signed out just now. Try again in a moment.";
  expect(await page({ notice: "signOutFailed" })).toContain(line);
  expect(await page({ notice: "accountDeleted" })).not.toContain(line);
  expect(await page({ notice: "toString" })).not.toContain(line);
});
