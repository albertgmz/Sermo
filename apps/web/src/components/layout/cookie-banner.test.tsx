import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { forgetBanner } from "@/lib/sermo/banner";
import { siteBody } from "@/lib/test-bodies";

mock.module("server-only", () => ({}));
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));
let cookie: string | undefined;
let requestCookie = "";
mock.module("next/headers", () => ({
  headers: async () =>
    new Headers({
      "cf-ipcountry": "US",
      ...(requestCookie ? { cookie: requestCookie } : {}),
    }),
  cookies: async () => ({
    get: (name: string) =>
      name === "forum_consent" && cookie !== undefined
        ? { name, value: cookie }
        : undefined,
  }),
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string) => key,
}));
const nextNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...nextNavigation,
  useRouter: () => ({ refresh: () => {} }),
}));
const { CookieBanner } = await import("./cookie-banner");
const { CookieConsentRoot } = await import("./cookie-consent-root");

const realFetch = globalThis.fetch;
let site: Record<string, unknown> = {};
let banner = true;
let bannerAsked = 0;
beforeEach(() => {
  cookie = undefined;
  requestCookie = "";
  forgetBanner();
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
    locale: string;
  };

test("the banner carries the site's policy version, and asks the backend nothing while it is for everyone", async () => {
  site = { cookiePolicyVersion: 6 };
  expect(await propsOf()).toMatchObject({
    version: 6,
    quiet: false,
    locale: "en",
  });
  expect(bannerAsked).toBe(0);
});

test("a Europe-only site has the backend say whether this visitor is asked", async () => {
  site = { cookieBannerOutsideEu: false };
  banner = false;
  expect((await propsOf()).quiet).toBe(true);
  banner = true;
  forgetBanner();
  expect((await propsOf()).quiet).toBe(false);
  expect(bannerAsked).toBe(2);
});

test("a visitor who answered an earlier version, or who is signed in, is asked even where the site is silent", async () => {
  site = { cookieBannerOutsideEu: false, cookiePolicyVersion: 3 };
  banner = false;
  cookie = undefined;
  expect((await propsOf()).quiet).toBe(true);
  cookie = encodeURIComponent(
    JSON.stringify({ categories: ["necessary"], revision: 2 }),
  );
  expect((await propsOf()).quiet).toBe(false);
  // Garbage is no answer.
  cookie = "garbage";
  expect((await propsOf()).quiet).toBe(true);
  cookie = undefined;
  requestCookie = "sermo.session_token=tok";
  expect((await propsOf()).quiet).toBe(false);
  requestCookie = "";
  // The backend is asked only for the guests who never answered (once: its answer is kept).
  expect(bannerAsked).toBe(1);
});

test("the root draws only the hidden cookie icon that Accept all copies", () => {
  const html = renderToStaticMarkup(
    createElement(CookieConsentRoot, {
      texts: {},
      locale: "en",
      version: 1,
      quiet: false,
    }),
  );
  expect(html).toStartWith('<span hidden="">');
  expect(html).toContain("<svg");
  expect(html).toContain("lucide-cookie");
  expect(html).toContain('aria-hidden="true"');
});
