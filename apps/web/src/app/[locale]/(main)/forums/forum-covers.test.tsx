import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { siteBody } from "@/lib/test-bodies";
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
const liteMode = { ...(await import("@/lib/lite-mode")) };
mock.module("@/lib/lite-mode", () => ({
  ...liteMode,
  liteBlocks: async () => false,
}));

const { viewerOfRequest } = await import("@/lib/sermo/client");
const { ForumList } = await import("./forum-list");
const { default: ForumPage } = await import("./[id]/page");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next/cache", () => nextCache);
  mock.module("@/lib/lite-mode", () => liteMode);
});
beforeEach(() => {
  mock.module("@/lib/sermo/session", () => ({ getViewer: viewerOfRequest }));
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const STAMP = "2026-01-01T00:00:00.000Z";
const COVER = "/api/v1/files/77";

const node = (id: number, parentId: number | null, cover: boolean) => ({
  id,
  parentId,
  type: parentId === null ? "category" : "forum",
  title: parentId === null ? `Category ${id}` : `Forum ${id}`,
  description: "",
  icon: null,
  iconKey: null,
  cover: cover ? { fileId: 77, url: COVER } : null,
  position: id,
  tabId: null,
  depth: parentId === null ? 0 : 1,
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
  },
});

// Category 1 has a cover, category 2 has none; forum 3 has a cover, forum 4 has none.
const NODES = [
  node(1, null, true),
  node(3, 1, true),
  node(2, null, false),
  node(4, 2, false),
];

function backend() {
  globalThis.fetch = (async (url: string) => {
    const { pathname } = new URL(url);
    if (pathname === "/api/v1/me") return Response.json(viewerBody(false));
    if (pathname === "/api/v1/site") return Response.json(siteBody({}));
    if (pathname === "/api/v1/nodes")
      return Response.json({ items: NODES, nextCursor: null });
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
    const match = /^\/api\/v1\/nodes\/(\d+)$/.exec(pathname);
    if (match) {
      const found = NODES.find((entry) => entry.id === Number(match[1]));
      return Response.json({
        node: found,
        watching: null,
        seo: {
          title: found?.title,
          description: "",
          canonical: `http://localhost/forums/${found?.id}`,
          robots: "noindex,follow",
          redirect: false,
          jsonLd: [],
        },
        breadcrumbs: [],
        resolvedPermissions: {},
      });
    }
    return Response.json({ items: [], sticky: [], nextCursor: null });
  }) as unknown as typeof fetch;
}

async function html(node: React.ReactNode) {
  const stream = await renderToReadableStream(withIntl(node), {
    onError: () => {},
  });
  await stream.allReady;
  return new Response(stream).text();
}

// The category's header is the button that folds it; its section is the one around it.
function header(page: string, title: string) {
  return page.slice(
    page.lastIndexOf("<section", page.indexOf(title)),
    page.indexOf("</h2>", page.indexOf(title)),
  );
}

test("a category with a cover draws it behind its header, lazily, and one without draws the plain header", async () => {
  backend();
  const page = await html(
    await ForumList({
      section: null,
      stats: "threads",
      hrefFor: () => "/",
    }),
  );
  const covered = header(page, "Category 1");
  expect(covered).toContain(`src="${COVER}"`);
  expect(covered).toContain('loading="lazy"');
  expect(covered).toContain("md:min-h-24");
  expect(covered).toContain("from-background/95");
  const plain = header(page, "Category 2");
  expect(plain).not.toContain("<img");
  expect(plain).not.toContain("from-background");
  expect(plain).toContain("min-h-12");
});

test("a forum page with a cover draws it behind its title in a box that keeps its shape, and one without looks as before", async () => {
  backend();
  const covered = await html(
    await ForumPage({
      params: Promise.resolve({ locale: "en", id: "3" }),
      searchParams: Promise.resolve({}),
    }),
  );
  const title = covered.slice(
    covered.lastIndexOf('<div class="mt-1 flex', covered.indexOf("<h1")),
    covered.indexOf("<h1"),
  );
  expect(covered).toContain(`background-image:url(&quot;${COVER}&quot;)`);
  expect(title).toContain("aspect-(--aspect-cover)");
  expect(title).toContain("from-background/95");
  const plain = await html(
    await ForumPage({
      params: Promise.resolve({ locale: "en", id: "4" }),
      searchParams: Promise.resolve({}),
    }),
  );
  expect(plain).not.toContain("background-image");
  expect(plain).not.toContain("from-background/95");
  expect(plain).not.toContain("aspect-(--aspect-cover)");
});
