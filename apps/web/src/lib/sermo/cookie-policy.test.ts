import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { viewerBody } from "@/lib/test-viewer";

mock.module("server-only", () => ({}));
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));
const COOKIE = "sermo.session_token=abc";
mock.module("next/headers", () => ({
  headers: async () => new Headers({ cookie: COOKIE }),
  cookies: async () => ({ get: () => undefined }),
}));
const { getCookiePolicyText } = await import("./cookie-policy");

afterAll(() => {
  mock.module("next/cache", () => nextCache);
});

const WRITTEN = {
  slug: "cookies",
  title: "Our cookies",
  bodyHtml: "<p>We keep it short.</p>",
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
let asked: (string | null)[] = [];
let answer: (withCookie: boolean) => Response = () => Response.json(WRITTEN);
beforeEach(() => {
  asked = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    const cookie = new Headers(init.headers).get("cookie");
    if (path === "/api/v1/me") return Response.json(viewerBody(true));
    if (path === "/api/v1/pages/cookies") {
      asked.push(cookie);
      return answer(cookie !== null);
    }
    throw new Error(`Unexpected request ${url}`);
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("the administrator's text is the shared read, asked without the visitor's cookie", async () => {
  answer = () => Response.json(WRITTEN);
  expect(await getCookiePolicyText()).toEqual(WRITTEN);
  expect(asked).toEqual([null]);
});

test("a text a guest cannot have is read as the visitor", async () => {
  answer = (withCookie) =>
    withCookie
      ? Response.json({ ...WRITTEN, isPublished: false })
      : NOT_FOUND();
  expect((await getCookiePolicyText())?.isPublished).toBe(false);
  expect(asked).toEqual([null, COOKIE]);
});

test("no text at all leaves the draft that ships with the site", async () => {
  answer = () => NOT_FOUND();
  expect(await getCookiePolicyText()).toBeNull();
});
