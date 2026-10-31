import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { translator } from "@/lib/test-intl";
import { textOfTree } from "@/lib/test-tree";
import { viewerBody } from "@/lib/test-viewer";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));
// A signed-in visitor: the per-visitor reads carry this cookie, the shared read of the text does not.
const COOKIE = "sermo.session_token=abc";
mock.module("next/headers", () => ({
  headers: async () => new Headers({ cookie: COOKIE }),
  cookies: async () => ({ get: () => undefined }),
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace, true),
}));
const { StaticPage } = await import("./static-page");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next/cache", () => nextCache);
});

const PAGE = {
  slug: "privacy",
  title: "Privacy policy",
  bodyHtml: "<h2>What we keep</h2><p>Only what the forum needs.</p>",
  isPublished: true,
  version: 1,
  updatedAt: "2026-10-01T10:00:00.000Z",
};

const NOT_FOUND = () =>
  Response.json(
    { error: { code: "not_found", message: "Not found" } },
    { status: 404 },
  );

const realFetch = globalThis.fetch;
let asked: { path: string; cookie: string | null }[] = [];
// The answer for the page: to a request without the visitor's cookie, and to one with it.
let pageAnswer: (withCookie: boolean) => Response = () => Response.json(PAGE);
beforeEach(() => {
  asked = [];
  pageAnswer = () => Response.json(PAGE);
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    const cookie = new Headers(init.headers).get("cookie");
    asked.push({ path, cookie });
    if (path === "/api/v1/me") return Response.json(viewerBody(true));
    if (path === "/api/v1/navigation")
      return Response.json({ header: [], mobile: [], account: [], footer: [] });
    if (path === "/api/v1/pages/privacy") return pageAnswer(cookie !== null);
    throw new Error(`Unexpected request ${url}`);
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const render = async () =>
  textOfTree(await StaticPage({ slug: "privacy", path: "/privacy" }), [
    "HtmlContent",
  ]);

test("the text is the shared read, asked without the visitor's cookie, so every visitor gets the same cached page", async () => {
  const shown = await render();
  expect(shown).toContain("Privacy policy");
  expect(shown).toContain(`[HtmlContent ${PAGE.bodyHtml}]`);
  const pageReads = asked.filter(
    ({ path }) => path === "/api/v1/pages/privacy",
  );
  expect(pageReads).toEqual([{ path: "/api/v1/pages/privacy", cookie: null }]);
});

test("a page the shared read cannot give (unpublished, opened by an administrator) is read as the visitor", async () => {
  pageAnswer = (withCookie) =>
    withCookie
      ? Response.json({ ...PAGE, title: "Draft policy", isPublished: false })
      : NOT_FOUND();
  const shown = await render();
  expect(shown).toContain("Draft policy");
  const pageReads = asked.filter(
    ({ path }) => path === "/api/v1/pages/privacy",
  );
  expect(pageReads.map(({ cookie }) => cookie)).toEqual([null, COOKIE]);
});
