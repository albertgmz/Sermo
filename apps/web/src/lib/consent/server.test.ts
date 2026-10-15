import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { CONSENT_COOKIE } from "@/lib/consent/inventory";
import { siteBody } from "@/lib/test-bodies";

mock.module("server-only", () => ({}));
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));
let consent: string | undefined;
let requestHeaders: Record<string, string> = {};
mock.module("next/headers", () => ({
  headers: async () => new Headers(requestHeaders),
  cookies: async () => ({
    get: (name: string) =>
      name === CONSENT_COOKIE && consent !== undefined
        ? { name, value: consent }
        : undefined,
  }),
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string) => key,
}));
const { getConsent } = await import("./server");

const realFetch = globalThis.fetch;
let site: Record<string, unknown> = {};
let banner: "shown" | "hidden" | "fails" = "shown";
let bannerAsked: Headers[] = [];
beforeEach(() => {
  consent = undefined;
  site = {};
  banner = "shown";
  bannerAsked = [];
  requestHeaders = {};
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (url.endsWith("/api/v1/site")) return Response.json(siteBody(site));
    bannerAsked.push(new Headers(init?.headers));
    if (banner === "fails") throw new TypeError("connection refused");
    return Response.json({ show: banner === "shown" });
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const choice = (revision: number, ...categories: string[]) =>
  encodeURIComponent(
    JSON.stringify({ categories: ["necessary", ...categories], revision }),
  );

test("the choice is read against the policy version the site has", async () => {
  site = { cookiePolicyVersion: 5 };
  consent = choice(5, "embeds");
  expect(await getConsent()).toEqual({ decided: true, accepted: ["embeds"] });
  // The choice before the last "ask everyone again".
  consent = choice(4, "embeds");
  expect(await getConsent()).toEqual({ decided: false, accepted: [] });
});

test("a site that shows the banner to everyone never asks whether it applies", async () => {
  expect((await getConsent()).decided).toBe(false);
  expect(bannerAsked).toEqual([]);
});

test("a Europe-only site: a visitor it does not ask counts as accepting, one it asks as having chosen nothing", async () => {
  site = { cookieBannerOutsideEu: false };
  banner = "hidden";
  expect(await getConsent()).toEqual({
    decided: false,
    accepted: ["analytics", "referrals", "embeds"],
    implied: true,
  });
  banner = "shown";
  expect(await getConsent()).toEqual({ decided: false, accepted: [] });
  // The backend cannot say: the visitor is asked.
  banner = "fails";
  expect(await getConsent()).toEqual({ decided: false, accepted: [] });
});

test("a visitor who chose keeps the choice, and the backend is not asked", async () => {
  site = { cookieBannerOutsideEu: false };
  banner = "hidden";
  consent = choice(1, "referrals");
  expect(await getConsent()).toEqual({
    decided: true,
    accepted: ["referrals"],
  });
  expect(bannerAsked).toEqual([]);
});

test("the backend is told the proxy's location, and not who the visitor is", async () => {
  site = { cookieBannerOutsideEu: false };
  banner = "hidden";
  requestHeaders = {
    cookie: "sermo.session_token=tok",
    "cf-ipcountry": "US",
    "x-forwarded-for": "198.51.100.7",
  };
  await getConsent();
  expect(bannerAsked).toHaveLength(1);
  expect(bannerAsked[0]?.get("cf-ipcountry")).toBe("US");
  expect(bannerAsked[0]?.get("x-forwarded-for")).toBe("198.51.100.7");
  expect(bannerAsked[0]?.get("cookie")).toBeNull();
});
