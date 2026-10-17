import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { siteBody } from "@/lib/test-bodies";

const realFetch = globalThis.fetch;

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string) => key,
}));
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));

const { GET } = await import("./route");

afterEach(() => {
  globalThis.fetch = realFetch;
});
afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next/cache", () => nextCache);
});

test("the OpenSearch description is served as one, named as the site is", async () => {
  globalThis.fetch = (async () =>
    Response.json(
      siteBody({ name: "Garden Club" }),
    )) as unknown as typeof fetch;
  const response = await GET();
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe(
    "application/opensearchdescription+xml; charset=utf-8",
  );
  expect(response.headers.get("cache-control")).toBe("public, max-age=300");
  const body = await response.text();
  expect(body).toContain("<ShortName>Garden Club</ShortName>");
  expect(body).toContain("/search?q={searchTerms}");
});
