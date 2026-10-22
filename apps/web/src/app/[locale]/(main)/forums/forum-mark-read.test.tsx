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

const { viewerOfRequest } = await import("@/lib/sermo/client");
const { ForumList } = await import("./forum-list");
const { default: ForumPage } = await import("./[id]/page");

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
const node = (
  id: number,
  parentId: number | null,
  type: "category" | "forum",
) => ({
  id,
  parentId,
  type,
  title: `${type === "category" ? "Category" : "Forum"} ${id}`,
  description: "",
  icon: null,
  iconKey: null,
  cover: null,
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
const NODES = [node(1, null, "category"), node(2, 1, "forum")];

function backend(signedIn: boolean) {
  globalThis.fetch = (async (url: string) => {
    const { pathname } = new URL(url);
    if (pathname === "/api/v1/me") return Response.json(viewerBody(signedIn));
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
const list = async () =>
  html(
    await ForumList({ section: null, stats: "threads", hrefFor: () => "/" }),
  );
const forumPage = async (id: string) =>
  html(
    await ForumPage({
      params: Promise.resolve({ locale: "en", id }),
      searchParams: Promise.resolve({}),
    }),
  );

test("a member sees Mark forums read on the forum list, a guest does not", async () => {
  backend(true);
  expect(await list()).toContain("Mark forums read");
  backend(false);
  expect(await list()).not.toContain("Mark forums read");
});

test("a member sees Mark forum read on a forum and on a category, a guest does not", async () => {
  backend(true);
  for (const id of ["1", "2"])
    expect(await forumPage(id), id).toContain("Mark forum read");
  backend(false);
  for (const id of ["1", "2"])
    expect(await forumPage(id), id).not.toContain("Mark forum read");
});
