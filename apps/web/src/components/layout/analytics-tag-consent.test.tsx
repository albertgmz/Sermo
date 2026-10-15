import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { CONSENT_COOKIE } from "@/lib/consent/inventory";
import { siteBody } from "@/lib/test-bodies";
import layout from "../../../messages/en/layout.json";

// The real tag, the real consent reader and the real site client; only the request and the
// network are stood in for. Taking `analyticsFor` out of the tag fails the first test.
let consent: string | undefined;
mock.module("server-only", () => ({}));
// Bun applies module mocks to the whole run, so these match the ones in the other suites.
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) =>
      name === CONSENT_COOKIE && consent !== undefined
        ? { name, value: consent }
        : undefined,
    toString: () => "",
  }),
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string) =>
    (layout.site as Record<string, string>)[key],
}));
const { AnalyticsTag } = await import("./analytics-tag");

const realFetch = globalThis.fetch;
const matomo = {
  provider: "matomo",
  url: "https://stats.example.com",
  siteId: 3,
};
beforeEach(() => {
  globalThis.fetch = (async () =>
    Response.json(siteBody({ analytics: matomo }))) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  consent = undefined;
});

const choice = (revision: number, ...categories: string[]) =>
  encodeURIComponent(JSON.stringify({ categories, revision }));
const tag = async () => JSON.stringify(await AnalyticsTag());

test("no tag before a choice, after a refusal, for another category or another policy version", async () => {
  for (const value of [
    undefined,
    "garbage",
    choice(1, "necessary"),
    choice(1, "necessary", "embeds", "referrals"),
    choice(2, "necessary", "analytics"),
  ]) {
    consent = value;
    expect(await tag(), String(value)).toBe("null");
  }
});

test("the tag is drawn once analytics is accepted, and gone when it is withdrawn", async () => {
  consent = choice(1, "necessary", "analytics");
  const accepted = await tag();
  expect(accepted).toContain("https://stats.example.com/matomo.js");
  expect(accepted).toContain("analytics-matomo");
  consent = choice(1, "necessary");
  expect(await tag()).toBe("null");
});

test("Matomo in its cookieless mode is drawn with no choice, with cookies disabled, and stays when a choice refuses analytics", async () => {
  globalThis.fetch = (async () =>
    Response.json(
      siteBody({ analytics: matomo, matomoCookieless: true }),
    )) as unknown as typeof fetch;
  for (const value of [undefined, choice(1, "necessary")]) {
    consent = value;
    const drawn = await tag();
    expect(drawn, String(value)).toContain("analytics-matomo");
    expect(drawn).toContain("disableCookies");
  }
});

test("the cookieless setting does nothing for another provider", async () => {
  globalThis.fetch = (async () =>
    Response.json(
      siteBody({
        analytics: { provider: "google", measurementId: "G-ABCD1234" },
        matomoCookieless: true,
      }),
    )) as unknown as typeof fetch;
  consent = undefined;
  expect(await tag()).toBe("null");
});
