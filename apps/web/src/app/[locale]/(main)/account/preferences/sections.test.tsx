import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { translator, withIntl } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

const { PreferencesSection } = await import("./sections");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

async function section(keyboardShortcuts: boolean) {
  globalThis.fetch = (async () =>
    Response.json({
      watchOnCreate: "none",
      watchOnReply: "none",
      language: null,
      profileViewPrivacy: "everyone",
      profilePostPrivacy: "members",
      keyboardShortcuts,
      homeTab: null,
      feedView: "cards",
      theme: null,
      showOnline: true,
    })) as unknown as typeof fetch;
  const element = await PreferencesSection({
    searchParams: Promise.resolve({}),
  });
  return new Response(await renderToReadableStream(withIntl(element))).text();
}

test("keyboard shortcuts are a checkbox, ticked while they are on, and not a select", async () => {
  const on = await section(true);
  expect(on).toMatch(/<input[^>]*type="checkbox"[^>]*name="keyboardShortcuts"/);
  expect(on).toMatch(/<input[^>]*name="keyboardShortcuts"[^>]*checked/);
  expect(on).not.toContain('<select id="pref-keyboardShortcuts"');
  const off = await section(false);
  expect(off).toMatch(/<input[^>]*name="keyboardShortcuts"/);
  expect(off).not.toMatch(/<input[^>]*name="keyboardShortcuts"[^>]*checked/);
});
