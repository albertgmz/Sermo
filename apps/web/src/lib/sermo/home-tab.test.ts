import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

mock.module("server-only", () => ({}));
const nextCache = await import("next/cache");
const headersModule = await import("next/headers");
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers({ cookie: "sermo.session_token=abc" }),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
afterAll(() => {
  mock.module("next/cache", () => nextCache);
  mock.module("next/headers", () => headersModule);
});

import { viewerBody } from "@/lib/test-viewer";

const { getDefaultTab } = await import("./home-tab");

function backend(answer: (path: string) => Response) {
  const asked: { path: string; headers: Headers }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    asked.push({
      path: new URL(url).pathname,
      headers: new Headers(init.headers),
    });
    return answer(new URL(url).pathname);
  }) as unknown as typeof fetch;
  return asked;
}

test("a guest's default is read without the visitor, so it can be shared", async () => {
  const asked = backend(() => Response.json({ tab: "forums" }));
  expect(await getDefaultTab(false)).toBe("forums");
  expect(asked).toHaveLength(1);
  expect(asked[0]?.path).toBe("/api/v1/site/home-tab");
  expect(asked[0]?.headers.get("cookie")).toBeNull();
});

test("a failed read gives Latest and never throws", async () => {
  const log = spyOn(console, "error").mockImplementation(() => {});
  backend(() =>
    Response.json({ error: { code: "internal" } }, { status: 500 }),
  );
  expect(await getDefaultTab(false)).toBe("latest");
  log.mockRestore();
});

test("a member's default is read as the member", async () => {
  const asked = backend((path) =>
    Response.json(path.endsWith("/me") ? viewerBody(true) : { tab: "hot" }),
  );
  expect(await getDefaultTab(true)).toBe("hot");
  // The visitor is settled on the session first (once per request, shared with the page).
  const read = asked.filter((entry) => entry.path === "/api/v1/site/home-tab");
  expect(read).toHaveLength(1);
  expect(read[0]?.headers.get("cookie")).toContain("sermo.session_token=abc");
});
