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

const node = (id: number, tabId: number | null) => ({
  id,
  parentId: null,
  type: "category" as const,
  title: `Category ${id}`,
  description: "",
  icon: null,
  iconKey: null,
  cover: null,
  position: id,
  tabId,
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
    isAdult: false,
  },
  adultByParent: false,
});

// Two sections: 1 under "Main", 2 under "Games"; 3 under both.
const NODES = [node(1, 11), node(2, 12), node(3, null)];
const TABS = [11, 12].map((id) => ({
  id,
  title: id === 11 ? "Main" : "Games",
  position: id,
  createdAt: STAMP,
  updatedAt: STAMP,
}));

function backend() {
  globalThis.fetch = (async (url: string) => {
    const { pathname } = new URL(url);
    if (pathname === "/api/v1/me") return Response.json(viewerBody(false));
    if (pathname === "/api/v1/site") return Response.json(siteBody({}));
    if (pathname === "/api/v1/nodes")
      return Response.json({ items: NODES, nextCursor: null });
    if (pathname === "/api/v1/forum-tabs")
      return Response.json({ items: TABS, nextCursor: null });
    return Response.json({ items: [], nextCursor: null });
  }) as unknown as typeof fetch;
}

async function html(node: React.ReactNode) {
  const stream = await renderToReadableStream(withIntl(node), {
    onError: () => {},
  });
  await stream.allReady;
  return new Response(stream).text();
}

// The sections bar: the links of the navigation named "Forum sections".
function bar(page: string) {
  const from = page.indexOf("<nav");
  return page.slice(from, page.indexOf("</nav>", from));
}

const open = (page: string) =>
  [...bar(page).matchAll(/<a [^>]*>/g)]
    .filter(([link]) => link.includes('aria-current="page"'))
    .map(([link]) => /href="([^"]*)"/.exec(link)?.[1]);

test("the section tabs are plain links to the page, the first with no section in its address", async () => {
  backend();
  const page = await html(await ForumList({ params: {} }));
  const links = [...bar(page).matchAll(/href="([^"]*)"/g)].map(
    ([, href]) => href,
  );
  expect(links).toEqual(["/", "/?section=12"]);
  expect(page).not.toContain("data-switch-panel");
});

test("the section the address names is the open tab and its categories are drawn; an unknown one is the first", async () => {
  backend();
  const second = await html(await ForumList({ params: { section: "12" } }));
  expect(open(second)).toEqual(["/?section=12"]);
  expect(second).toContain("Category 2");
  expect(second).toContain("Category 3");
  expect(second).not.toContain("Category 1");
  const unknown = await html(await ForumList({ params: { section: "99" } }));
  expect(open(unknown)).toEqual(["/"]);
  expect(unknown).toContain("Category 1");
  expect(unknown).not.toContain("Category 2");
});

test("a section link keeps the statistics tab the address names", async () => {
  backend();
  const page = await html(
    await ForumList({ params: { section: "12", stats: "viewed" } }),
  );
  const links = [...bar(page).matchAll(/href="([^"]*)"/g)].map(
    ([, href]) => href,
  );
  expect(links).toEqual(["/?stats=viewed", "/?section=12&amp;stats=viewed"]);
});

// The bar stays on screen when a section is pressed; only the categories, drawn again for each
// section (their key), show their placeholder while they load.
test("the categories are drawn again for each section, and the bar is not part of them", async () => {
  const drawn = (await ForumList({ params: { section: "12" } })) as {
    props: { children: { key: string | null }[] };
  };
  const [tabs, categories] = drawn.props.children;
  expect(tabs.key).toBeNull();
  expect(categories.key).toBe("12");
  const first = (await ForumList({ params: {} })) as {
    props: { children: { key: string | null }[] };
  };
  expect(first.props.children[1].key).toBe("");
});
