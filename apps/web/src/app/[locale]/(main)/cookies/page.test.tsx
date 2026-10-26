import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { siteBody } from "@/lib/test-bodies";
import { translator } from "@/lib/test-intl";
import { textOfTree } from "@/lib/test-tree";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace, true),
}));
const { default: CookiePolicyPage } = await import("./page");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next/cache", () => nextCache);
});

const realFetch = globalThis.fetch;
let site: Record<string, unknown> = {};
let written: Record<string, unknown> | null = null;
beforeEach(() => {
  site = {};
  written = null;
  globalThis.fetch = (async (url: string) => {
    if (url.endsWith("/api/v1/site")) return Response.json(siteBody(site));
    if (url.endsWith("/api/v1/privacy/log-retention"))
      return Response.json({ days: 90 });
    if (url.endsWith("/api/v1/pages/cookies"))
      return written
        ? Response.json(written)
        : Response.json(
            { error: { code: "not_found", message: "Not found" } },
            { status: 404 },
          );
    throw new Error(`Unexpected request ${url}`);
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});
const textOf = (node: unknown) => textOfTree(node, ["HtmlContent"]);
const page = async () => textOf(await CookiePolicyPage());
const policy = messages.cookies.policy;

test("without the administrator's text the page shows the draft that ships with the site", async () => {
  const shown = await page();
  expect(shown).toContain(policy.title);
  expect(shown).toContain(policy.intro);
  expect(shown).not.toContain("[HtmlContent");
});

test("the administrator's text takes the place of the draft, and the table of cookies stays", async () => {
  written = {
    slug: "cookies",
    title: "Our cookies",
    bodyHtml: "<p>We keep it short.</p>",
    isPublished: true,
    version: 1,
    updatedAt: "2026-10-01T10:00:00.000Z",
  };
  const shown = await page();
  expect(shown).toContain("Our cookies");
  expect(shown).toContain("[HtmlContent <p>We keep it short.</p>]");
  expect(shown).not.toContain(policy.intro);
  // The inventory is generated, never typed: every category is still there.
  expect(shown).toContain(messages.cookies.items.session.title);
  expect(shown).toContain(messages.cookies.items.google.title);
  expect(shown).toContain(messages.cookies.items.referral.title);
  expect(shown).toContain(messages.cookies.items.embeds.title);
});

test("the policy version shown is the site's", async () => {
  site = { cookiePolicyVersion: 7 };
  expect(await page()).toContain("Policy version 7");
});

test("the statistics are listed and ask for consent", async () => {
  const shown = await page();
  expect(shown).toContain(messages.cookies.items.google.title);
  expect(shown).toContain(policy.optionalNote);
});

test("what the server keeps about a member's cookie choice is stated", async () => {
  expect(await page()).toContain(messages.cookies.logged.choice.title);
});
