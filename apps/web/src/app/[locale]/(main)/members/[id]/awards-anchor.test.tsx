import { afterAll, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { translator, withIntl } from "@/lib/test-intl";

// The level strip links to `<profile>/about#awards`. The router keeps the page left behind in the
// document, hidden (the wall, whose side column holds the cards too), so only the About tab's copy
// of the awards card may carry the id: one `#awards` on every page, the one that is shown.

mock.module("server-only", () => ({}));
const intlServer = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  ...intlServer,
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
const nextIntl = { ...(await import("next-intl")) };
const { useTranslations } = await import("use-intl");
mock.module("next-intl", () => ({
  ...nextIntl,
  useLocale: () => "en",
  useTranslations,
}));

const card = {
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
};
const profile = {
  id: 5,
  username: "wren",
  about: "",
  signatureHtml: null,
  groupTitle: "Member",
  createdAt: "2026-01-01T00:00:00.000Z",
  card,
};
// The profile and the cards' reads, as the pages make them.
const reads = await import("@/app/[locale]/(main)/members/[id]/profile");
mock.module("@/app/[locale]/(main)/members/[id]/profile", () => ({
  ...reads,
  getProfile: async () => profile,
  getHeldAwards: async () => ({ items: [] }),
}));
const client = await import("@/lib/sermo/client");
mock.module("@/lib/sermo/client", () => ({
  ...client,
  read: async () => ({ items: [], nextCursor: null }),
}));
mock.module("@/lib/sermo/session", () => ({
  getViewer: async () => ({ user: null }),
}));

afterAll(() => {
  mock.module("next/navigation", () => navigation);
  mock.module("next-intl", () => nextIntl);
  mock.module("next-intl/server", () => intlServer);
  mock.module("@/app/[locale]/(main)/members/[id]/profile", () => reads);
  mock.module("@/lib/sermo/client", () => client);
});

const { default: AboutTab } = await import("./about/page");
const { ProfilePanel } = await import("./sections");

async function html(element: unknown) {
  const stream = await renderToReadableStream(withIntl(element as never));
  await stream.allReady;
  return new Response(stream).text();
}

const anchors = (page: string) => page.match(/id="awards"/g)?.length ?? 0;

test("the About tab holds the awards card's anchor once", async () => {
  const page = await html(
    await AboutTab({
      params: Promise.resolve({ locale: "en", id: "5" }),
    } as never),
  );
  expect(page).toContain("Awards");
  expect(anchors(page)).toBe(1);
});

test("the side column of the wall, the posts and the threads holds no anchor", async () => {
  const page = await html(
    <ProfilePanel profile={profile as never}>
      <p>The list</p>
    </ProfilePanel>,
  );
  expect(page).toContain("Awards");
  expect(anchors(page)).toBe(0);
});
