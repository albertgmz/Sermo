import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { siteBody } from "@/lib/test-bodies";

mock.module("server-only", () => ({}));
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));
let cookieHeader = "";
const jar = new Map<string, string>();
mock.module("next/headers", () => ({
  headers: async () =>
    new Headers(cookieHeader ? { cookie: cookieHeader } : undefined),
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name) } : undefined,
  }),
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string) => key,
}));
const { saveConsentChoice } = await import("./actions");

const realFetch = globalThis.fetch;
let saved: { body: unknown; cookie: string | null }[] = [];
let version = 2;
let consentStatus = 200;
beforeEach(() => {
  saved = [];
  jar.clear();
  cookieHeader = "";
  version = 2;
  consentStatus = 200;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (url.endsWith("/api/v1/site"))
      return Response.json(siteBody({ cookiePolicyVersion: version }));
    const body = JSON.parse(String(init?.body));
    saved.push({ body, cookie: new Headers(init?.headers).get("cookie") });
    if (consentStatus !== 200)
      return new Response("down", { status: consentStatus });
    return Response.json({
      record: { ...body, decidedAt: "2026-10-02T10:00:00.000Z" },
    });
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const choice = (revision: number, ...categories: string[]) =>
  encodeURIComponent(
    JSON.stringify({
      categories: ["necessary", ...categories],
      revision,
      consentTimestamp: "2026-10-02T10:00:00.000Z",
    }),
  );

test("a member's choice in the banner is sent to the account as the cookie holds it", async () => {
  cookieHeader = "sermo.session_token=tok; forum_consent=x";
  jar.set("forum_consent", choice(2, "analytics", "embeds"));
  await saveConsentChoice();
  expect(saved).toEqual([
    {
      // With the time the banner recorded for the choice.
      body: {
        categories: ["analytics", "embeds"],
        policyVersion: 2,
        decidedAt: "2026-10-02T10:00:00.000Z",
      },
      cookie: "sermo.session_token=tok",
    },
  ]);
  // Refusing everything is a choice too.
  saved.length = 0;
  jar.set("forum_consent", choice(2));
  await saveConsentChoice();
  expect(saved.map((call) => call.body)).toEqual([
    {
      categories: [],
      policyVersion: 2,
      decidedAt: "2026-10-02T10:00:00.000Z",
    },
  ]);
});

test("a guest has no account: nothing is sent", async () => {
  jar.set("forum_consent", choice(2, "analytics"));
  await saveConsentChoice();
  expect(saved).toEqual([]);
});

test("a choice made under another policy version, or none at all, is not sent", async () => {
  cookieHeader = "sermo.session_token=tok";
  jar.set("forum_consent", choice(1, "analytics"));
  await saveConsentChoice();
  jar.delete("forum_consent");
  await saveConsentChoice();
  jar.set("forum_consent", "garbage");
  await saveConsentChoice();
  expect(saved).toEqual([]);
});

test("a refusal or an outage is left for the next choice, never thrown", async () => {
  const quiet = console.error;
  console.error = () => {};
  try {
    cookieHeader = "sermo.session_token=tok";
    jar.set("forum_consent", choice(2, "analytics"));
    for (const status of [401, 409, 503]) {
      consentStatus = status;
      await saveConsentChoice();
    }
    expect(saved).toHaveLength(3);
  } finally {
    console.error = quiet;
  }
});
