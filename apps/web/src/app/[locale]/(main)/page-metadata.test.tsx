import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { createTranslator } from "use-intl";
import { messagesFor } from "@/i18n/messages";
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
  for (const tab of ["latest", "hot", "forums", "media"]) {
    const metadata = await head({ tab });
    expect(typeof metadata.title, tab).toBe("string");
    expect(String(metadata.description), tab).toContain("Garden Club");
    seen.add(`${metadata.title}|${metadata.description}`);
  }
  expect(seen.size).toBe(4);
  expect((await head({ tab: "hot" })).openGraph).toBeUndefined();
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
  expect((await head()).alternates?.canonical).toBe("http://localhost:3000/");
  expect((await head({ tab: "hot" })).alternates?.canonical).toBe(
    "http://localhost:3000/",
  );
  expect((await head({ tab: "latest" })).alternates?.canonical).toBe(
    "http://localhost:3000/?tab=latest",
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
      "http://localhost:3000/?tab=hot",
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
    "http://localhost:3000/?tab=following",
  );
  backend();
  const guest = await head({ tab: "following" });
  expect(guest.robots).toEqual({ index: false, follow: true });
  expect(guest.alternates?.canonical).toBe("http://localhost:3000/");
  expect(guest.title).toBe("Latest threads and posts");
});

test("the owner's own description speaks for the home address only", async () => {
  backend({ description: "A club for gardeners." });
  expect((await head()).description).toBe("A club for gardeners.");
  expect((await head({ tab: "hot" })).description).toContain("Garden Club");
});

test("a member whose own tab differs gets the head of the tab shown; a guest does not depend on it", async () => {
  backend({ member: true, siteTab: "latest", own: "hot" });
  const member = await head();
  expect(member.title).toBe("Trending threads");
  expect(member.alternates?.canonical).toBe("http://localhost:3000/?tab=hot");
  backend({ siteTab: "latest" });
  const guest = await head();
  expect(guest.title).toBe("Latest threads and posts");
  expect(guest.alternates?.canonical).toBe("http://localhost:3000/");
});

test("tracking parameters leave a plain tab address indexed", async () => {
  backend();
  const metadata = await head({ utm_source: "news", fbclid: "x", ref: "7" });
  expect(metadata.robots).toEqual({ index: true, follow: true });
  expect(metadata.alternates?.canonical).toBe("http://localhost:3000/");
});
