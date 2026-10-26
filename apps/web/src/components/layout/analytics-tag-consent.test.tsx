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
const { AnalyticsScript } = await import("./analytics-script");

const realFetch = globalThis.fetch;
const google = { provider: "google", measurementId: "G-ABC123" };
beforeEach(() => {
  globalThis.fetch = (async () =>
    Response.json(siteBody({ analytics: google }))) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  consent = undefined;
});

const choice = (revision: number, ...categories: string[]) =>
  encodeURIComponent(JSON.stringify({ categories, revision }));
const tag = async () => JSON.stringify(await AnalyticsTag());

test("the provider's script is fetched once the page is idle, and its settings are queued at once", async () => {
  consent = choice(1, "necessary", "analytics");
  type Script = { type: unknown; props: { id: string; strategy: string } };
  const tree = (await AnalyticsTag()) as unknown as {
    props: { children: Script[] };
  };
  const [loader, config] = tree.props.children;
  expect(loader.props.id).toBe("analytics-google-js");
  expect(loader.props.strategy).toBe("lazyOnload");
  expect(config.props.id).toBe("analytics-google");
  expect(config.props.strategy).toBe("afterInteractive");
  // Both take the document's nonce in the browser: the tag's layout may first mount on a soft
  // navigation, whose answer carries another.
  expect(config.type).toBe(AnalyticsScript);
  expect(loader.type).toBe(AnalyticsScript);
});

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
  expect(accepted).toContain(
    "https://www.googletagmanager.com/gtag/js?id=G-ABC123",
  );
  expect(accepted).toContain("analytics-google");
  consent = choice(1, "necessary");
  expect(await tag()).toBe("null");
});

test("with a tag path the tag loads from the site's own address, and still only after the choice", async () => {
  globalThis.fetch = (async () =>
    Response.json(
      siteBody({ analytics: { ...google, tagPath: "/metrics" } }),
    )) as unknown as typeof fetch;
  consent = undefined;
  expect(await tag()).toBe("null");
  consent = choice(1, "necessary", "analytics");
  const accepted = await tag();
  expect(accepted).toContain('"src":"/metrics/"');
  expect(accepted).not.toContain("googletagmanager.com");
  consent = choice(1, "necessary");
  expect(await tag()).toBe("null");
});
