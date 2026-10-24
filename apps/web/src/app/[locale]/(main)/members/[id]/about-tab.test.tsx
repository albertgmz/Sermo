import { afterAll, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { translator, withIntl } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
const intlServer = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  usePathname: () => "/members/5",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, prefetch() {} }),
}));
// Another suite replaces the translator with one that fills no placeholders: use the real one.
const nextIntl = { ...(await import("next-intl")) };
const { useTranslations } = await import("use-intl");
mock.module("next-intl", () => ({
  ...nextIntl,
  useLocale: () => "en",
  useTranslations,
}));

const { About } = await import("./sections");

afterAll(() => {
  mock.module("next/navigation", () => navigation);
  mock.module("next-intl", () => nextIntl);
  mock.module("next-intl/server", () => intlServer);
});

const profile = {
  id: 5,
  username: "wren",
  about: "",
  signatureHtml: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  card: {
    id: 5,
    username: "wren",
    avatar: null,
    frame: null,
    nameColor: null,
    nameIcon: null,
    title: "",
    badges: [],
    level: 1,
    restricted: false,
  },
} as never;

async function about(isOwn: boolean) {
  const stream = await renderToReadableStream(
    withIntl(<About profile={profile} isOwn={isOwn} cards={null} />),
  );
  await stream.allReady;
  return new Response(stream).text();
}

test("the member's own About tab gives the whole referral address, with Copy and Share, as the widget does", async () => {
  const html = await about(true);
  expect(html).toMatch(/<input[^>]*value="https?:\/\/[^"/]+\/register\?ref=5"/);
  expect(html).toContain("Copy");
  expect(html).toContain('aria-label="Share"');
  // No bare relative path to select by hand.
  expect(html).not.toContain(">/register?ref=5<");
});

test("another member's About tab shows no referral link", async () => {
  expect(await about(false)).not.toContain("register?ref=");
});
