import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { translator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;

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

const { viewerOfRequest } = await import("@/lib/sermo/client");
const { default: AwardsPage } = await import("./page");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
});
// Another test file leaves a stand-in for the viewer in place: the page asks the backend.
beforeEach(() => {
  mock.module("@/lib/sermo/session", () => ({ getViewer: viewerOfRequest }));
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const STAMP = "2026-01-01T00:00:00.000Z";

function award(
  id: number,
  isActive: boolean,
  category: { id: number; title: string } | null = null,
) {
  return {
    id,
    name: `Award ${id}`,
    description: "",
    icon: "star",
    image: null,
    tier: "gold",
    category,
    xp: 10,
    credits: 0,
    isStackable: false,
    isActive,
    rule: { match: "all", conditions: [] },
    grantCount: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

function category(id: number, title: string, description = "") {
  return {
    id,
    title,
    description,
    position: id,
    awardCount: 0,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

// The backend lists inactive awards too to a holder of admin.awards; users.list is answered with
// `members`, the categories with `categories` (none by default).
function backend(
  members: () => Response,
  awards?: () => Response,
  categories: () => Response = () => Response.json({ items: [] }),
) {
  globalThis.fetch = (async (url: string) => {
    const { pathname } = new URL(url);
    if (pathname === "/api/v1/me") return Response.json(viewerBody(false));
    if (pathname === "/api/v1/awards/categories") return categories();
    if (pathname === "/api/v1/awards") {
      if (awards) return awards();
      return Response.json({ items: [award(1, true), award(2, false)] });
    }
    if (pathname === "/api/v1/members") return members();
    return Response.json(
      { error: { code: "not_found", message: "?" } },
      { status: 404 },
    );
  }) as unknown as typeof fetch;
}

async function page() {
  const errors: unknown[] = [];
  const stream = await renderToReadableStream(withIntl(await AwardsPage()), {
    onError: (error) => {
      errors.push(error);
    },
  });
  await stream.allReady;
  return { html: await new Response(stream).text(), errors };
}

const refused = (status: number, code: string) => () =>
  Response.json({ error: { code, message: "Not for you." } }, { status });

test("an inactive award is left out of the public catalogue", async () => {
  backend(refused(403, "forbidden"));
  const { html } = await page();
  expect(html).toContain("Award 1");
  expect(html).not.toContain("Award 2");
});

test("a guest who may not open profiles gets the catalogue without the ranking, and no error", async () => {
  for (const [status, code] of [
    [403, "forbidden"],
    [401, "unauthenticated"],
  ] as const) {
    backend(refused(status, code));
    const { html, errors } = await page();
    expect(errors, code).toEqual([]);
    expect(html, code).toContain("Award 1");
    expect(html, code).not.toContain(messages.awards.awards.leadersHeading);
  }
});

test("a failure on the backend's side is still raised", async () => {
  backend(refused(500, "internal"));
  const { errors } = await page();
  expect(errors).not.toEqual([]);
});

const member = (id: number) => ({
  card: {
    id,
    username: `member${id}`,
    avatar: null,
    frame: null,
    nameColor: null,
    nameIcon: null,
    title: "",
    badges: [],
    level: 1,
    restricted: false,
  },
  createdAt: STAMP,
  postCount: 0,
  reactionScore: 0,
  awardXp: 40,
  credits: 0,
  awardCount: 0,
  referralCount: 0,
});

test("the ranking is there when the backend gives it, and asks for members who have earned XP", async () => {
  const asked: string[] = [];
  backend(() =>
    Response.json({ items: [member(7)], nextCursor: null, total: null }),
  );
  const inner = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const { pathname, search } = new URL(url);
    if (pathname === "/api/v1/members") asked.push(search);
    return inner(url, init);
  }) as unknown as typeof fetch;
  const { html, errors } = await page();
  expect(errors).toEqual([]);
  expect(html).toContain(messages.awards.awards.leadersHeading);
  expect(html).toContain("member7");
  expect(asked).toHaveLength(1);
  expect(asked[0]).toContain("sort=level");
  expect(asked[0]).toContain("ranked=true");
});

test("nobody has earned XP: the ranking card is left out", async () => {
  backend(() => Response.json({ items: [], nextCursor: null, total: null }));
  const { html, errors } = await page();
  expect(errors).toEqual([]);
  expect(html).not.toContain(messages.awards.awards.leadersHeading);
});

test("a guest who may not open profiles is told so where the catalogue would be, without an error", async () => {
  const refusedList = refused(403, "forbidden");
  backend(refusedList, refusedList);
  const { html, errors } = await page();
  expect(errors).toEqual([]);
  expect(html).toContain(messages.awards.awards.restricted);
});

test("the catalogue is grouped by category in the backend's order, the rest last under Others", async () => {
  const posts = { id: 3, title: "By posts" };
  const welcome = { id: 5, title: "Welcome" };
  backend(
    refused(403, "forbidden"),
    () =>
      Response.json({
        items: [
          award(11, true, welcome),
          award(12, true, posts),
          award(13, true, posts),
          award(14, true, null),
          award(15, true, { id: 99, title: "Unknown" }),
        ],
      }),
    () =>
      Response.json({
        items: [
          category(5, "Welcome", "The first steps."),
          category(3, "By posts"),
          category(4, "Empty"),
        ],
      }),
  );
  const { html, errors } = await page();
  expect(errors).toEqual([]);
  const at = (text: string) => html.indexOf(text);
  const order = [
    "Welcome",
    "The first steps.",
    "Award 11",
    "By posts",
    "Award 12",
    "Award 13",
    messages.awards.awards.others,
    "Award 14",
    "Award 15",
  ].map(at);
  expect(order.every((index) => index >= 0)).toBe(true);
  expect(order).toEqual([...order].sort((a, b) => a - b));
  // An empty category is left out; no tier is named.
  expect(html).not.toContain("Empty");
  expect(html).not.toContain(">Gold<");
  expect(html).toContain('id="category-3"');
});

test("without categories the one group is the whole catalogue", async () => {
  backend(refused(403, "forbidden"));
  const { html } = await page();
  expect(/<h3 id="section-others"[^>]*>([^<]*)</.exec(html)?.[1]).toBe(
    messages.awards.awards.catalogueHeading,
  );
  expect(html).not.toContain(`>${messages.awards.awards.others}<`);
});
