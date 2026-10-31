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
const { ForumThreads } = await import("./forum-threads");

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
    isAdult: false,
  },
  adultByParent: false,
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
  author: { kind: "member", id: 4, username: "member4" },
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
    user: { kind: "member", id: 4, username: "member4" },
  },
  readPosition: null,
  isUnread: false,
  pollKind: null,
  isAdult: false,
  adultByForum: false,
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

const props = {
  nodeId: 2,
  newThread: null,
  signedIn: true,
  resolved: {},
};

test("a prefix chosen in the forum's filter draws the filter and the threads of that prefix", async () => {
  forum();
  const text = await html(
    await ForumThreads({ ...props, prefix: "3", page: 1 }),
  );
  const read = urls.find((url) => url.includes("/threads?"));
  expect(new URL(read ?? "http://none").searchParams.get("prefixId")).toBe("3");
  expect(text).toContain("A solved thread");
  // The filter shows the prefix chosen, as links to the forum's lists.
  expect(text).toContain('aria-label="Prefix: Solved"');
  expect(text).not.toContain("<h1");
});

test("the list follows the page asked for in the address", async () => {
  forum();
  await html(await ForumThreads({ ...props, prefix: "3", page: 1 }));
  const read = urls.find((url) => url.includes("/threads?"));
  expect(new URL(read ?? "http://none").searchParams.get("page")).toBe("1");
});

test("something that is not a prefix id narrows nothing", async () => {
  forum();
  await html(await ForumThreads({ ...props, prefix: "x", page: 1 }));
  const read = urls.find((url) => url.includes("/threads?"));
  expect(new URL(read ?? "http://none").searchParams.has("prefixId")).toBe(
    false,
  );
});

// The filter stays on screen when a prefix is chosen; only the list, drawn again for each prefix,
// shows its placeholder while it loads.
test("the list is drawn again for each prefix, and the filter is not part of it", async () => {
  forum();
  const drawn = (await ForumThreads({ ...props, prefix: "3", page: 1 })) as {
    props: { children: { type: unknown; key: string | null }[] };
  };
  const [filter, list] = drawn.props.children;
  expect(list.key).toBe("3");
  expect(filter.type).not.toBe(list.type);
  const other = (await ForumThreads({
    ...props,
    prefix: undefined,
    page: 1,
  })) as {
    props: { children: { key: string | null }[] };
  };
  expect(other.props.children[1].key).toBe("");
});
