import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import { createTranslator } from "use-intl";
import { messagesFor } from "@/i18n/messages";
import { DEFAULT_ICON_PNG } from "@/lib/pwa-icon-data";
import { siteBody } from "@/lib/test-bodies";

// The share card routes as a crawler asks for them: a PNG for a page guests may open, a 404 for
// anything else. The backend's answers are faked at `fetch`, as the real client sends them.
mock.module("server-only", () => ({}));
const intl = { ...(await import("next-intl/server")) };
const catalogue = await messagesFor("en");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) =>
    createTranslator({
      locale: "en",
      messages: catalogue,
      namespace: namespace as never,
    }),
}));
const nextCache = { ...(await import("next/cache")) };
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));

const { GET: pageRoute } = await import("./[kind]/[id]/route");
const { GET: siteRoute } = await import("./site/route");
const { brandOf, cardOf, cardPath, siteContent } = await import(
  "@/lib/og/card"
);

afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next/cache", () => nextCache);
});

const realFetch = globalThis.fetch;
const TRAIL = {
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Jardín" },
    { "@type": "ListItem", position: 2, name: "Rosales y trepadoras" },
  ],
};
const POSTING = {
  "@type": "DiscussionForumPosting",
  headline:
    "¿Cuál es la mejor época del año para podar los rosales trepadores en climas mediterráneos con veranos secos?",
  author: { "@type": "Person", name: "Íñigo" },
};
const PROFILE = {
  "@type": "ProfilePage",
  mainEntity: { "@type": "Person", name: "wren", description: "Grows roses." },
};
const seo = (robots: string, jsonLd: unknown[], description = "") => ({
  title: "Built by the backend",
  description,
  canonical: "http://localhost:3000/x",
  robots,
  redirect: false,
  jsonLd,
});
const notFound = () =>
  Response.json(
    { error: { code: "not_found", message: "Not found." } },
    { status: 404 },
  );

// What the backend answers a guest, by path. A missing thread, one in a forum closed to guests, a
// hidden or a moderated one: the backend says the same "not found" for each.
let site = siteBody();
let icon: () => Response;
const ANSWERS: Record<string, () => Response> = {
  "/api/v1/seo/threads/12": () =>
    Response.json(seo("index,follow", [POSTING, TRAIL])),
  "/api/v1/seo/threads/14": () => Response.json(seo("noindex,follow", [TRAIL])),
  "/api/v1/seo/threads/15": () =>
    Response.json(
      { error: { code: "internal", message: "Down." } },
      { status: 500 },
    ),
  "/api/v1/seo/nodes/3": () =>
    Response.json(seo("index,follow", [TRAIL], "Poda, plagas y variedades.")),
  "/api/v1/seo/nodes/5": notFound,
  "/api/v1/seo/users/4": () => Response.json(seo("index,follow", [PROFILE])),
  "/api/v1/seo/users/6": () => Response.json(seo("noindex,follow", [])),
};
const asked: string[] = [];
const sent: Headers[] = [];

beforeEach(() => {
  site = siteBody({ description: "A club for gardeners." });
  icon = () =>
    new Response(Buffer.from(DEFAULT_ICON_PNG[180], "base64"), {
      headers: { "content-type": "image/png" },
    });
  asked.length = 0;
  sent.length = 0;
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    asked.push(url.pathname);
    sent.push(new Headers(init?.headers));
    if (url.pathname === "/api/v1/site") return Response.json(site);
    if (url.pathname === "/api/v1/files/6") return icon();
    return (ANSWERS[url.pathname] ?? notFound)();
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const get = (path: string, headers?: HeadersInit) => {
  const request = new NextRequest(`http://localhost:3000${path}`, { headers });
  const [, , kind, id] = new URL(request.url).pathname.split("/");
  return kind === "site"
    ? siteRoute(request)
    : pageRoute(request, { params: Promise.resolve({ kind, id }) });
};

async function expectCard(response: Response) {
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/png");
  const bytes = new Uint8Array(await response.arrayBuffer());
  // A PNG, small enough for every app that previews links (WhatsApp drops one over 300 KB).
  expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(bytes.length).toBeLessThan(300 * 1024);
  // 1200 x 630, from the PNG header.
  const view = new DataView(bytes.buffer);
  expect([view.getUint32(16), view.getUint32(20)]).toEqual([1200, 630]);
}

const KEPT = "public, max-age=31536000, immutable";
const FRESH = "public, max-age=300";

test("a public thread, forum and member each have a card", async () => {
  for (const path of ["/og/threads/12", "/og/forums/3", "/og/members/4"]) {
    const response = await get(path);
    await expectCard(response);
    // Asked for without the key a page names, it is drawn as things are now and kept briefly.
    expect(response.headers.get("cache-control")).toBe(FRESH);
  }
  // Each read as a guest: no cookie, only the SEO read (which counts no view) and the site.
  expect(asked).not.toContain("/api/v1/threads/12");
});

test("the site has a card of its own", async () => {
  await expectCard(await get("/og/site"));
});

test("the address a page names is kept for a year; a stale key only for minutes", async () => {
  const brand = brandOf({ name: "Garden Club", icon: null, accents: [] });
  const thread = cardOf("threads", seo("index,follow", [POSTING, TRAIL]));
  if (!thread) throw new Error("expected a thread card");
  const named = await get(cardPath(thread, 12, brand));
  await expectCard(named);
  expect(named.headers.get("cache-control")).toBe(KEPT);
  const own = await get(
    cardPath(
      siteContent({
        name: "Garden Club",
        description: "A club for gardeners.",
      }),
      null,
      brand,
    ),
  );
  expect(own.headers.get("cache-control")).toBe(KEPT);
  // The thread was renamed since: the old key gets today's card, not kept for long.
  const renamed = cardPath({ ...thread, title: "Old title" }, 12, brand);
  const stale = await get(renamed);
  await expectCard(stale);
  expect(stale.headers.get("cache-control")).toBe(FRESH);
});

test("the site's uploaded icon is drawn, and a card that could not read it is not kept", async () => {
  site = siteBody({
    description: "A club for gardeners.",
    icon: { fileId: 6, url: "/api/v1/files/6" },
  });
  const brand = brandOf({
    name: "Garden Club",
    icon: { fileId: 6, url: "/api/v1/files/6" },
    accents: [],
  });
  const path = cardPath(
    siteContent({ name: "Garden Club", description: "A club for gardeners." }),
    null,
    brand,
  );
  icon = () => new Response("gone", { status: 500 });
  const without = await get(path);
  await expectCard(without);
  expect(without.headers.get("cache-control")).toBe(FRESH);
  // Once the icon reads, the card is drawn whole and kept.
  icon = () =>
    new Response(Buffer.from(DEFAULT_ICON_PNG[180], "base64"), {
      headers: { "content-type": "image/png" },
    });
  asked.length = 0;
  const drawn = await get(path);
  await expectCard(drawn);
  expect(asked).toContain("/api/v1/files/6");
  expect(drawn.headers.get("cache-control")).toBe(KEPT);
  // A card drawn whole is not drawn again: the icon is not read a second time.
  icon = () => new Response("gone", { status: 500 });
  asked.length = 0;
  const again = await get(path);
  await expectCard(again);
  expect(asked).not.toContain("/api/v1/files/6");
  expect(again.headers.get("cache-control")).toBe(KEPT);
});

test("an icon too big to draw gives the drawn mark, kept like any card", async () => {
  site = siteBody({
    description: "Big icon.",
    icon: { fileId: 6, url: "/api/v1/files/6" },
  });
  icon = () =>
    new Response(new Uint8Array(600 * 1024), {
      headers: { "content-type": "image/png" },
    });
  const brand = brandOf({
    name: "Garden Club",
    icon: { fileId: 6, url: "/api/v1/files/6" },
    accents: [],
  });
  const path = cardPath(
    siteContent({ name: "Garden Club", description: "Big icon." }),
    null,
    brand,
  );
  const drawn = await get(path);
  await expectCard(drawn);
  expect(drawn.headers.get("cache-control")).toBe(KEPT);
});

test("a card is read as a guest: the visitor's cookie and address never reach the backend", async () => {
  const response = await get("/og/threads/12", {
    cookie: "sermo.session_token=secret",
    "x-forwarded-for": "203.0.113.9",
  });
  await expectCard(response);
  expect(asked).toContain("/api/v1/seo/threads/12");
  for (const headers of sent) {
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("x-forwarded-for")).toBeNull();
  }
});

test("missing, private, hidden or moderated content, and a page kept out of the index, have no card", async () => {
  for (const path of [
    // Not found for a guest: missing, hidden, moderated, or in a forum closed to guests.
    "/og/threads/13",
    "/og/forums/5",
    // Open, but not to be indexed (a thin page, or text closed to guests).
    "/og/threads/14",
    "/og/members/6",
    // No such kind or id.
    "/og/posts/12",
    "/og/threads/12-pruning",
    "/og/threads/0",
  ]) {
    const response = await get(path);
    expect({ path, status: response.status }).toEqual({ path, status: 404 });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBeNull();
  }
});

test("a backend that fails is not taken for a missing page", async () => {
  const response = await get("/og/threads/15");
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("no-store");
});
