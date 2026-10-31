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

const { PrivacySection } = await import("./sections");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

async function section(showDevice: boolean) {
  globalThis.fetch = (async () =>
    Response.json({
      watchOnCreate: "none",
      watchOnReply: "none",
      language: null,
      profileViewPrivacy: "everyone",
      profilePostPrivacy: "members",
      keyboardShortcuts: true,
      homeTab: null,
      feedView: "cards",
      theme: null,
      showOnline: true,
      showDevice,
    })) as unknown as typeof fetch;
  const element = await PrivacySection({ searchParams: Promise.resolve({}) });
  return new Response(await renderToReadableStream(withIntl(element))).text();
}

test("the device box is ticked while the device is shown, and not ticked when it is hidden", async () => {
  const shown = await section(true);
  expect(shown).toMatch(/<input[^>]*type="checkbox"[^>]*name="showDevice"/);
  expect(shown).toMatch(/<input[^>]*name="showDevice"[^>]*checked/);
  const hidden = await section(false);
  expect(hidden).toMatch(/<input[^>]*name="showDevice"/);
  expect(hidden).not.toMatch(/<input[^>]*name="showDevice"[^>]*checked/);
});
