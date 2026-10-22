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
let blocked = false;
const liteMode = { ...(await import("@/lib/lite-mode")) };
mock.module("@/lib/lite-mode", () => ({
  ...liteMode,
  liteBlocks: async () => blocked,
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
  blocked = false;
  globalThis.fetch = realFetch;
});

const STAMP = "2026-01-01T00:00:00.000Z";
const COVER = "/api/v1/files/77";

const ICON = "/api/v1/files/88";

const node = (
  id: number,
  parentId: number | null,
  type: "category" | "forum",
  picture: "cover" | "icon" | null,
) => ({
  id,
  parentId,
  type,
  title: `${type === "category" ? "Category" : "Forum"} ${id}`,
  description: type === "forum" ? "About it" : "",
  icon: picture === "icon" ? { fileId: 88, url: ICON } : null,
  iconKey: null,
  cover: picture === "cover" ? { fileId: 77, url: COVER } : null,
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
    requirePrefix: false,
  },
});

// 9: a top-level forum before them all. 1: the first category, with a cover. 2: a category with none. 5: a later category with a cover.
// 6: a forum at the top level, with a cover. 7: a category with an icon only.
const NODES = [
  node(9, null, "forum", null),
  node(1, null, "category", "cover"),
  node(3, 1, "forum", "cover"),
  node(2, null, "category", null),
  node(4, 2, "forum", null),
  node(5, null, "category", "cover"),
  node(6, null, "forum", "cover"),
  node(7, null, "category", "icon"),
  node(8, 7, "forum", null),
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

// The panel of a category: its header is the button that folds it.
function panel(page: string, title: string) {
  const at = page.indexOf(title);
  return page.slice(
    page.lastIndexOf("<section", at),
    page.indexOf("</section>", at),
  );
}
const header = (page: string, title: string) => {
  const whole = panel(page, title);
  return whole.slice(0, whole.indexOf("</h2>"));
};

const list = async () =>
  html(
    await ForumList({
      section: null,
      stats: "threads",
      hrefFor: () => "/",
    }),
  );

test("the first category header, even after a forum, draws its cover at once and a later one lazily", async () => {
  backend();
  const page = await list();
  const first = header(page, "Category 1");
  expect(first).toContain(`background-image:url(&quot;${COVER}&quot;)`);
  expect(first).not.toContain("<img");
  expect(first).toContain("md:min-h-24");
  expect(first).toContain("from-background/95");
  expect(first).toContain("text-foreground");
  const later = header(page, "Category 5");
  expect(later).toContain(`src="${COVER}"`);
  expect(later).toContain('loading="lazy"');
});

test("a category with no cover, or with an icon only, has the plain header", async () => {
  backend();
  const page = await list();
  for (const title of ["Category 2", "Category 7"]) {
    const plain = header(page, title);
    expect(plain, title).not.toContain("<img");
    expect(plain, title).not.toContain("background-image");
    expect(plain, title).not.toContain("from-background");
    expect(plain, title).toContain("min-h-12");
    expect(plain, title).not.toContain(ICON);
  }
});

test("a forum at the top level shows its cover once, on its card, not also behind its header", async () => {
  backend();
  const forum = panel(await list(), "Forum 6");
  expect(forum.split(COVER).length - 1).toBe(1);
  expect(header(await list(), "Forum 6")).not.toContain(COVER);
});

test("with forum pictures blocked by LITE mode the headers stay plain and announce no picture", async () => {
  backend();
  blocked = true;
  const page = await list();
  for (const title of ["Category 1", "Category 5"]) {
    const plain = header(page, title);
    expect(plain, title).not.toContain(COVER);
    expect(plain, title).not.toContain("lite-placeholder");
    expect(plain, title).not.toContain('role="img"');
    expect(plain, title).toContain("min-h-12");
  }
});

const forumPage = async (id: string) =>
  html(
    await ForumPage({
      params: Promise.resolve({ locale: "en", id }),
      searchParams: Promise.resolve({}),
    }),
  );
// From the box around the title to the title.
const top = (page: string) =>
  page.slice(
    page.lastIndexOf('<div class="mt-1 flex', page.indexOf("<h1")),
    page.indexOf("</h1>"),
  );

test("a forum page with a cover draws it behind its title in a box that keeps its shape", async () => {
  backend();
  const covered = await forumPage("3");
  expect(covered).toContain(`background-image:url(&quot;${COVER}&quot;)`);
  // The box is a least height, so a long title or description makes it grow; an aspect ratio
  // with a clipped overflow would cut the content off instead.
  expect(top(covered)).toContain("min-h-36");
  expect(top(covered)).not.toContain("aspect-");
  expect(top(covered)).toContain("from-background/95");
  // The description is in the foreground colour over a picture, not the muted one.
  expect(covered).toMatch(/text-foreground[^"]*">About it/);
});

test("a category page with a cover draws it behind its title and lists its forums below", async () => {
  backend();
  const page = await forumPage("1");
  expect(top(page)).toContain("min-h-36");
  expect(top(page)).toContain(`background-image:url(&quot;${COVER}&quot;)`);
  expect(page).toContain("Forum 3");
});

test("a page with no cover, or with an icon only, looks as before", async () => {
  backend();
  for (const id of ["4", "7"]) {
    const plain = await forumPage(id);
    expect(top(plain), id).not.toContain("from-background/95");
    expect(top(plain), id).not.toContain("min-h-36");
    expect(top(plain), id).not.toContain("background-image");
    expect(top(plain), id).not.toContain(ICON);
  }
});

test("with forum pictures blocked by LITE mode the page header stays plain", async () => {
  backend();
  blocked = true;
  const page = await forumPage("3");
  expect(top(page)).not.toContain(COVER);
  expect(top(page)).not.toContain("min-h-36");
  expect(top(page)).not.toContain("lite-placeholder");
});
