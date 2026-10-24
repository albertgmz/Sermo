import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { fakeBackend } from "@/app/[locale]/(staff)/admin/groups/test-backend";
import { siteBody } from "@/lib/test-bodies";
import { translator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

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
const { forumThreadsPage } = await import("./threads-page-action");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next/cache", () => nextCache);
});
beforeEach(() => {
  mock.module("@/lib/sermo/session", () => ({ getViewer: viewerOfRequest }));
});
let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());

const when = "2026-01-01T00:00:00.000Z";
const FORUM = {
  id: 2,
  parentId: null,
  type: "forum",
  title: "General",
  description: "",
  icon: null,
  iconKey: null,
  cover: null,
  position: 1,
  tabId: null,
  depth: 0,
  threadCount: 45,
  postCount: 90,
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
const thread = (id: number, title: string) => ({
  id,
  nodeId: 2,
  node: { id: 2, title: "General" },
  title,
  prefix: null,
  excerpt: "",
  cover: null,
  highlightedUntil: null,
  bumpedAt: null,
  author: { id: 4, username: "member4" },
  state: "visible",
  isSticky: false,
  isLocked: false,
  createdAt: when,
  replyCount: 0,
  viewCount: 1,
  firstPostId: 30,
  lastPost: {
    postId: 30,
    position: 0,
    postedAt: when,
    user: { id: 4, username: "member4" },
  },
  readPosition: null,
  isUnread: false,
  pollKind: null,
});

// A forum of 45 threads (three pages of 20), one of them on the page asked for.
function forum(items = [thread(8, "On page two")]) {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(false)),
    "site.get": () => Response.json(siteBody({})),
    "widgets.current": () => Response.json({ items: [] }),
    "nodes.get": () =>
      Response.json({
        node: FORUM,
        watching: null,
        seo: {
          title: "General",
          description: "",
          canonical: "http://localhost/forums/2",
          robots: "index,follow",
          redirect: false,
          jsonLd: [],
        },
        breadcrumbs: [],
        resolvedPermissions: {},
      }),
    "nodes.list": () => Response.json({ items: [FORUM], nextCursor: null }),
    "threadPrefixes.list": () => Response.json({ items: [], nextCursor: null }),
    "threads.list": () =>
      Response.json({ items, sticky: [], nextCursor: null, total: 45 }),
    "users.cards": () => Response.json({ items: [] }),
  });
}

async function draw(query: Record<string, string>) {
  const errors: unknown[] = [];
  const stream = await renderToReadableStream(
    withIntl(
      await ForumPage({
        params: Promise.resolve({ locale: "en", id: "2" }),
        searchParams: Promise.resolve(query),
      } as never),
    ),
    { onError: (error) => void errors.push(error) },
  );
  await stream.allReady;
  return { html: await new Response(stream).text(), errors };
}

test("a forum's threads are numbered pages whose links keep the prefix filter", async () => {
  forum();
  const { html, errors } = await draw({ page: "2", prefix: "3" });
  expect(errors).toEqual([]);
  expect(html).toContain("On page two");
  expect(html).toContain('aria-current="page"');
  // Plain links, with the filter kept: they work without scripts.
  expect(html).toContain('href="/forums/2?prefix=3&amp;page=3"');
  expect(html).toContain('href="/forums/2?prefix=3"');
  expect(html).not.toContain("cursor=");
});

test("a page past the last one goes to the last one, as XenForo does", async () => {
  forum([]);
  const { errors } = await draw({ page: "9" });
  expect(errors).toHaveLength(1);
  expect(String((errors[0] as { digest?: string }).digest)).toContain(
    ";/forums/2?page=3;",
  );
});

test("the in-place switch gets the page drawn, and nothing for a page with no threads", async () => {
  forum();
  const drawn = await forumThreadsPage(2, undefined, 2);
  const stream = await renderToReadableStream(withIntl(drawn));
  await stream.allReady;
  const html = await new Response(stream).text();
  expect(html).toContain("On page two");
  expect(html).toContain('href="/forums/2?page=3"');
  forum([]);
  expect(await forumThreadsPage(2, undefined, 5)).toBeNull();
});
