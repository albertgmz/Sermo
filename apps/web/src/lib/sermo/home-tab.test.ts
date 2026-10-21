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

const { getGuestTab } = await import("./home-tab");

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
  const asked = backend(() => Response.json({ tab: "media" }));
  expect(await getGuestTab()).toBe("media");
  expect(asked).toHaveLength(1);
  expect(asked[0]?.path).toBe("/api/v1/site/home-tab");
  expect(asked[0]?.headers.get("cookie")).toBeNull();
});

test("a refusal or an answer that is no tab gives Latest and never throws", async () => {
  const log = spyOn(console, "error").mockImplementation(() => {});
  backend(() =>
    Response.json({ error: { code: "internal" } }, { status: 500 }),
  );
  expect(await getGuestTab()).toBe("latest");
  expect(await getGuestTab()).toBe("latest");
  backend(() => Response.json({ tab: "photos" }));
  expect(await getGuestTab()).toBe("latest");
  globalThis.fetch = (async () => {
    throw new TypeError("connection refused");
  }) as unknown as typeof fetch;
  expect(await getGuestTab()).toBe("latest");
  log.mockRestore();
});
