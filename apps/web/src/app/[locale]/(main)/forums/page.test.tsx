import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { siteBody } from "@/lib/test-bodies";
import { translator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
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
const { default: ForumsPage } = await import("./page");
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
function backend(forumStatsEnabled: boolean) {
  asked.length = 0;
  globalThis.fetch = (async (url: string) => {
    const { pathname } = new URL(url);
    asked.push(pathname);
    if (pathname === "/api/v1/me") return Response.json(viewerBody(false));
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

const page = async () =>
  html(
    await ForumsPage({
      params: Promise.resolve({ locale: "en" }),
      searchParams: Promise.resolve({}),
    }),
  );

// The panel's own tab link: other suites replace the interface text, never an address.
const panel = 'href="/forums?stats=threads"';
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
