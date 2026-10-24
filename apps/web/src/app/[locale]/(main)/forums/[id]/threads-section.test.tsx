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
const { forumThreadsSection } = await import("./threads-section-action");

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
const node = (type: "forum" | "category") => ({
  id: 2,
  parentId: null,
  type,
  title: "General",
  description: "",
  icon: null,
  iconKey: null,
  cover: null,
  position: 1,
  tabId: null,
  depth: 0,
  threadCount: 1,
  postCount: 1,
  lastPost: null,
  permissions: { canPost: true, canModerate: false },
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
const TAG = { id: 3, label: "Solved", color: "#16a34a", icon: "" };
const SOLVED = {
  ...TAG,
  colorId: 1,
  position: 1,
  isActive: true,
  createdAt: when,
  updatedAt: when,
};
const thread = {
  id: 8,
  nodeId: 2,
  node: { id: 2, title: "General" },
  title: "A solved thread",
  prefix: TAG,
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
};

// Every address asked of the backend, with its query.
const urls: string[] = [];
function forum(type: "forum" | "category" = "forum", listing?: () => Response) {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(true)),
    "site.get": () => Response.json(siteBody({})),
    "nodes.get": () =>
      Response.json({
        node: node(type),
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
    "threadPrefixes.list": () =>
      Response.json({ items: [SOLVED], nextCursor: null }),
    "threads.list":
      listing ??
      (() =>
        Response.json({
          items: [thread],
          sticky: [],
          nextCursor: null,
          total: 1,
        })),
    "users.cards": () => Response.json({ items: [] }),
  });
  urls.length = 0;
  const inner = globalThis.fetch;
  globalThis.fetch = ((input: string, init: RequestInit) => {
    urls.push(String(input));
    return inner(input, init);
  }) as typeof fetch;
}

async function html(drawn: unknown) {
  const stream = await renderToReadableStream(withIntl(drawn as never));
  await stream.allReady;
  return new Response(stream).text();
}

test("a prefix chosen in the forum's filter draws the filter and the threads of that prefix, with no page around them", async () => {
  forum();
  const drawn = await forumThreadsSection(2, "?prefix=3");
  const read = urls.find((url) => url.includes("/threads?"));
  expect(new URL(read ?? "http://none").searchParams.get("prefixId")).toBe("3");
  const text = await html(drawn);
  expect(text).toContain("A solved thread");
  // The filter shows the prefix chosen.
  expect(text).toContain('aria-label="Prefix: Solved"');
  expect(text).not.toContain("<h1");
});

test("the section follows the page asked for in the address", async () => {
  forum();
  await forumThreadsSection(2, "?prefix=3&page=1");
  const read = urls.find((url) => url.includes("/threads?"));
  expect(new URL(read ?? "http://none").searchParams.get("page")).toBe("1");
});

test("a category has no threads to draw in place", async () => {
  forum("category");
  expect(await forumThreadsSection(2, "?prefix=3")).toBeNull();
});

test("what is not an address gives nothing, and the backend is not asked", async () => {
  forum();
  expect(await forumThreadsSection(2, 7 as never)).toBeNull();
  expect(urls).toEqual([]);
});

test("a forum the backend refuses gives nothing, so the browser opens the page itself", async () => {
  forum();
  backend?.restore();
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(true)),
    "site.get": () => Response.json(siteBody({})),
    "nodes.get": () =>
      Response.json(
        { error: { code: "not_found", message: "No such forum." } },
        { status: 404 },
      ),
  });
  expect(await forumThreadsSection(2, "?prefix=3")).toBeNull();
});
