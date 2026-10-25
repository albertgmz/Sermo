import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { createTranslator } from "use-intl";
import { messagesFor } from "@/i18n/messages";
import { brandOf, cardPath, siteContent } from "@/lib/og/card";
import { siteBody } from "@/lib/test-bodies";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
let locale: "en" | "es" = "en";
const catalogue = { en: await messagesFor("en"), es: await messagesFor("es") };
mock.module("next-intl/server", () => ({
  getLocale: async () => locale,
  getTranslations: async (namespace: string) =>
    createTranslator({
      locale,
      messages: catalogue[locale],
      namespace: namespace as never,
    }),
}));
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));

const { viewerOfRequest } = await import("@/lib/sermo/client");
const { generateMetadata } = await import("./page");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next/cache", () => nextCache);
});
beforeEach(() => {
  mock.module("@/lib/sermo/session", () => ({ getViewer: viewerOfRequest }));
  locale = "en";
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function backend({
  member = false,
  siteTab = "latest",
  own = null,
  description = "",
}: {
  member?: boolean;
  siteTab?: string;
  own?: string | null;
  description?: string;
} = {}) {
  globalThis.fetch = (async (url: string) => {
    const { pathname } = new URL(url);
    if (pathname === "/api/v1/me") {
      const body = viewerBody(member);
      if (body.user)
        Object.assign(body.user, { homeTab: own, openHomeTab: own ?? siteTab });
      return Response.json(body);
    }
    if (pathname === "/api/v1/site")
      return Response.json(siteBody({ description }));
    if (pathname === "/api/v1/site/home-tab")
      return Response.json({ tab: siteTab });
    throw new Error(`Unexpected ${pathname}`);
  }) as unknown as typeof fetch;
}

const head = (searchParams: Record<string, string> = {}) =>
  generateMetadata({
    params: Promise.resolve({ locale }),
    searchParams: Promise.resolve(searchParams),
  } as unknown as Parameters<typeof generateMetadata>[0]);

test("each tab has its own title and description, built from the site's name", async () => {
  backend();
  const seen = new Set<string>();
  for (const tab of ["latest", "hot", "media"]) {
    const metadata = await head({ tab });
    expect(typeof metadata.title, tab).toBe("string");
    expect(String(metadata.description), tab).toContain("Garden Club");
    seen.add(`${metadata.title}|${metadata.description}`);
  }
  expect(seen.size).toBe(3);
});

test("the feed page is shared under the title of its tab, with the site's card and feed", async () => {
  backend({ siteTab: "hot", description: "A club for gardeners." });
  const home = await head();
  // The site's own share card.
  const card = {
    url: `http://localhost:3000${cardPath(
      siteContent({
        name: "Garden Club",
        description: "A club for gardeners.",
      }),
      null,
      brandOf({ name: "Garden Club", icon: null, accents: [] }),
    )}`,
    type: "image/png",
    width: 1200,
    height: 630,
    alt: "Garden Club",
  };
  expect(card.url).toStartWith("http://localhost:3000/og/site?v=");
  const hot =
    "The threads people are replying to and reacting to right now on Garden Club.";
  expect(home.openGraph).toEqual({
    type: "website",
    title: "Trending threads",
    description: hot,
    url: "http://localhost:3000/whats-new",
    siteName: "Garden Club",
    locale: "en_US",
    images: [card],
  });
  expect(home.twitter).toEqual({
    card: "summary_large_image",
    title: "Trending threads",
    description: hot,
    images: [card],
  });
  expect(home.alternates?.types).toEqual({
    "application/atom+xml": [
      {
        title: "Latest threads on Garden Club",
        url: "http://localhost:3000/feed.atom",
      },
    ],
  });
  locale = "es";
  const latest = await head({ tab: "latest" });
  expect(latest.openGraph?.title).toBe("Últimos temas y publicaciones");
  expect(latest.openGraph?.url).toBe(
    "http://localhost:3000/whats-new?tab=latest",
  );
  expect(latest.openGraph?.locale).toBe("es_ES");
  expect(latest.alternates?.canonical).toBe(
    "http://localhost:3000/whats-new?tab=latest",
  );
});

test("a member's own Following list is not shared", async () => {
  backend({ member: true });
  const own = await head({ tab: "following" });
  expect(own.openGraph).toBeUndefined();
  expect(own.twitter).toBeUndefined();
  expect(own.alternates?.types).toBeUndefined();
});

test("the texts are in the page language", async () => {
  backend();
  locale = "es";
  const metadata = await head({ tab: "hot" });
  expect(metadata.title).toBe("Temas en tendencia");
  expect(metadata.description).toBe(
    "Los temas que la gente responde y valora ahora mismo en Garden Club.",
  );
  expect((await head({ tab: "media" })).title).toBe("Últimas imágenes");
});

test("the bare address is the canonical of the guests' tab; the others are named", async () => {
  backend({ siteTab: "hot" });
  expect((await head()).alternates?.canonical).toBe(
    "http://localhost:3000/whats-new",
  );
  expect((await head({ tab: "hot" })).alternates?.canonical).toBe(
    "http://localhost:3000/whats-new",
  );
  expect((await head({ tab: "latest" })).alternates?.canonical).toBe(
    "http://localhost:3000/whats-new?tab=latest",
  );
  expect((await head()).title).toBe("Trending threads");
});

test("a paged, filtered or picture address is noindex and points at the tab", async () => {
  backend();
  const variants: Record<string, string>[] = [
    { cursor: "abc" },
    { pages: "2" },
    { unread: "1" },
    { tag: "rust" },
    { picture: "4" },
  ];
  for (const extra of variants) {
    const metadata = await head({ tab: "hot", ...extra });
    expect(metadata.robots, JSON.stringify(extra)).toEqual({
      index: false,
      follow: true,
    });
    expect(metadata.alternates?.canonical).toBe(
      "http://localhost:3000/whats-new?tab=hot",
    );
  }
  expect((await head({ tab: "hot" })).robots).toEqual({
    index: true,
    follow: true,
  });
});

test("Following is never indexed, and a guest who asks for it gets a copy of Latest", async () => {
  backend({ member: true });
  const own = await head({ tab: "following" });
  expect(own.robots).toEqual({ index: false, follow: true });
  expect(own.alternates?.canonical).toBe(
    "http://localhost:3000/whats-new?tab=following",
  );
  backend();
  const guest = await head({ tab: "following" });
  expect(guest.robots).toEqual({ index: false, follow: true });
  expect(guest.alternates?.canonical).toBe("http://localhost:3000/whats-new");
  expect(guest.title).toBe("Latest threads and posts");
});

test("the owner's own description is the forum list's, not the feed's", async () => {
  backend({ description: "A club for gardeners." });
  expect((await head()).description).toBe(
    "The newest threads and replies on Garden Club.",
  );
});

test("a member whose own tab differs gets the head of the tab shown; a guest does not depend on it", async () => {
  backend({ member: true, siteTab: "latest", own: "hot" });
  const member = await head();
  expect(member.title).toBe("Trending threads");
  expect(member.alternates?.canonical).toBe(
    "http://localhost:3000/whats-new?tab=hot",
  );
  backend({ siteTab: "latest" });
  const guest = await head();
  expect(guest.title).toBe("Latest threads and posts");
  expect(guest.alternates?.canonical).toBe("http://localhost:3000/whats-new");
});

test("tracking parameters leave a plain tab address indexed", async () => {
  backend();
  const metadata = await head({ utm_source: "news", fbclid: "x", ref: "7" });
  expect(metadata.robots).toEqual({ index: true, follow: true });
  expect(metadata.alternates?.canonical).toBe(
    "http://localhost:3000/whats-new",
  );
});
