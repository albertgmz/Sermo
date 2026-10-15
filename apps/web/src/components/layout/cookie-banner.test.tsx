import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { siteBody } from "@/lib/test-bodies";

mock.module("server-only", () => ({}));
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers({ "cf-ipcountry": "US" }),
  cookies: async () => ({ get: () => undefined }),
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string) => key,
}));
const { CookieBanner } = await import("./cookie-banner");

const realFetch = globalThis.fetch;
let site: Record<string, unknown> = {};
let banner = true;
let bannerAsked = 0;
beforeEach(() => {
  site = {};
  banner = true;
  bannerAsked = 0;
  globalThis.fetch = (async (url: string) => {
    if (url.endsWith("/api/v1/site")) return Response.json(siteBody(site));
    bannerAsked += 1;
    return Response.json({ show: banner });
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const propsOf = async () =>
  (await CookieBanner({ locale: "en" })).props as {
    version: number;
    quiet: boolean;
    omit: string[];
    locale: string;
  };

test("the banner carries the site's policy version, and asks the backend nothing while it is for everyone", async () => {
  site = { cookiePolicyVersion: 6 };
  expect(await propsOf()).toMatchObject({
    version: 6,
    quiet: false,
    omit: [],
    locale: "en",
  });
  expect(bannerAsked).toBe(0);
});

test("a Europe-only site has the backend say whether this visitor is asked", async () => {
  site = { cookieBannerOutsideEu: false };
  banner = false;
  expect((await propsOf()).quiet).toBe(true);
  banner = true;
  expect((await propsOf()).quiet).toBe(false);
  expect(bannerAsked).toBe(2);
});

test("cookieless Matomo takes the statistics choice out of the banner, other analytics does not", async () => {
  site = {
    analytics: { provider: "matomo", url: "https://m.example.com/", siteId: 1 },
    matomoCookieless: true,
  };
  expect((await propsOf()).omit).toEqual(["analytics"]);
  site = {
    analytics: { provider: "matomo", url: "https://m.example.com/", siteId: 1 },
    matomoCookieless: false,
  };
  expect((await propsOf()).omit).toEqual([]);
  site = {
    analytics: { provider: "google", measurementId: "G-ABCD1234" },
    matomoCookieless: true,
  };
  expect((await propsOf()).omit).toEqual([]);
});
