import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { siteBody, widgetBody } from "@/lib/test-bodies";
import { translator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
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
const { default: ForumPage } = await import("./page");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next/cache", () => nextCache);
});
beforeEach(() => {
  mock.module("@/lib/sermo/session", () => ({ getViewer: viewerOfRequest }));
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const STAMP = "2026-01-01T00:00:00.000Z";
const CATEGORY = {
  id: 1,
  parentId: null,
  type: "category",
  title: "Category 1",
  description: "",
  icon: null,
  iconKey: null,
  cover: null,
  position: 1,
  tabId: null,
  depth: 0,
  threadCount: 0,
  postCount: 0,
  lastPost: null,
  permissions: { canPost: false, canModerate: false },
  settings: {
    requireThreadApproval: false,
    requireReplyApproval: false,
    isReadOnly: false,
    countsPosts: true,
    minAccountAgeDays: 0,
    minPostCount: 0,
    requirePrefix: false,
  },
};

const FORUM = {
  ...CATEGORY,
  id: 2,
  parentId: 1,
  type: "forum",
  title: "Forum 2",
  depth: 1,
  permissions: { canPost: true, canModerate: false },
};

const widgetsAsked: (string | null)[] = [];
function backend(widgets: unknown[], member = false) {
  widgetsAsked.length = 0;
  globalThis.fetch = (async (url: string) => {
    const { pathname, searchParams } = new URL(url);
    if (pathname === "/api/v1/me") return Response.json(viewerBody(member));
    if (pathname === "/api/v1/site") return Response.json(siteBody({}));
    if (pathname === "/api/v1/widgets") {
      widgetsAsked.push(searchParams.get("page"));
      return Response.json({ items: widgets });
    }
    if (pathname === "/api/v1/nodes")
      return Response.json({ items: [CATEGORY], nextCursor: null });
    if (pathname === "/api/v1/forum-tabs")
      return Response.json({
        items: [
          {
            id: 9,
            title: "Main",
            position: 0,
            createdAt: STAMP,
            updatedAt: STAMP,
          },
        ],
        nextCursor: null,
      });
    if (pathname === "/api/v1/nodes/unread")
      return Response.json({ nodeIds: [] });
    if (pathname === "/api/v1/nodes/2")
      return Response.json({
        node: FORUM,
        watching: { mode: "posts", email: false },
        seo: {
          title: "Forum 2",
          description: "",
          canonical: "http://localhost/forums/2",
          robots: "noindex,follow",
          redirect: false,
          jsonLd: [],
        },
        breadcrumbs: [],
        resolvedPermissions: {},
      });
    if (pathname === "/api/v1/nodes/1")
      return Response.json({
        node: CATEGORY,
        watching: null,
        seo: {
          title: "Category 1",
          description: "",
          canonical: "http://localhost/forums/1",
          robots: "noindex,follow",
          redirect: false,
          jsonLd: [],
        },
        breadcrumbs: [],
        resolvedPermissions: {},
      });
    return Response.json({ items: [], sticky: [], nextCursor: null, total: 0 });
  }) as unknown as typeof fetch;
}

async function draw(id = "1") {
  const stream = await renderToReadableStream(
    withIntl(
      await ForumPage({
        params: Promise.resolve({ locale: "en", id }),
        searchParams: Promise.resolve({}),
      }),
    ),
    { onError: () => {} },
  );
  await stream.allReady;
  return new Response(stream).text();
}

const text = (
  id: number,
  position: "forum_view_sidebar" | "sidebar_top" | "sidebar_bottom",
  body: string,
) =>
  widgetBody({
    id,
    position,
    type: "text",
    options: { body },
    bodyHtml: `<p>${body}</p>`,
  });

test("the forum's sidebar holds its widgets between the two global sidebars, beside the threads", async () => {
  backend([
    text(1, "sidebar_top", "global-top"),
    text(2, "forum_view_sidebar", "forum-own"),
    text(3, "sidebar_bottom", "global-bottom"),
  ]);
  const html = await draw();
  expect(widgetsAsked).toEqual(["forum"]);
  // Each widget streams in on its own, in the order of the column.
  const at = (word: string) => html.indexOf(word);
  expect(at("global-top")).toBeGreaterThan(html.indexOf("<aside"));
  expect(at("forum-own")).toBeGreaterThan(at("global-top"));
  expect(at("global-bottom")).toBeGreaterThan(at("forum-own"));
  // Beside the content from lg, under it on a phone (the layout's aside column).
  expect(html).toContain("lg:grid-cols-[minmax(0,1fr)_var(--aside-width)]");
  expect(html.indexOf("Category 1")).toBeLessThan(html.indexOf("<aside"));
});

test("a forum with no widgets has no sidebar column", async () => {
  backend([]);
  const html = await draw();
  expect(html).not.toContain("<aside");
  expect(html).not.toContain("lg:grid-cols-");
});

// As XenForo's forum header: "Mark read" and "Follow" are buttons beside the one that starts a
// thread, and what to follow is asked in Follow's popover, not laid out on the page.
test("a member's forum header holds Mark forum read and one Follow button beside New thread", async () => {
  backend([], true);
  const html = await draw("2");
  // The first of each after the heading: the header's own buttons.
  const header = html.slice(html.indexOf("<h1"));
  const at = (words: string) => header.indexOf(words);
  expect(at("Mark forum read")).toBeGreaterThan(-1);
  expect(at("Following")).toBeGreaterThan(at("Mark forum read"));
  expect(at("New thread")).toBeGreaterThan(at("Following"));
  expect(html).not.toContain('name="mode"');
  expect(html).not.toContain("Email me");
});
