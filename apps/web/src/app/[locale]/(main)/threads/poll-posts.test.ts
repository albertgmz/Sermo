import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { postBody } from "@/lib/test-bodies";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers({ cookie: "sermo.session_token=abc" }),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string) => key,
}));
const { viewerOfRequest } = await import("@/lib/sermo/client");
const { pollPosts } = await import("./poll-posts");

beforeEach(() => {
  mock.module("@/lib/sermo/session", () => ({ getViewer: viewerOfRequest }));
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const user = { id: 3, username: "ember" };
const threadBody = {
  thread: {
    id: 7,
    nodeId: 2,
    node: { id: 2, title: "Garden" },
    title: "Tomatoes",
    prefix: null,
    excerpt: "",
    cover: null,
    highlightedUntil: null,
    bumpedAt: null,
    author: user,
    state: "visible",
    isSticky: false,
    isLocked: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    replyCount: 1,
    viewCount: 1,
    firstPostId: 1,
    lastPost: {
      postId: 31,
      position: 25,
      postedAt: "2026-01-01T00:00:00.000Z",
      user,
    },
    readPosition: null,
    isUnread: false,
    pollKind: null,
  },
  seo: {
    title: "t",
    description: "d",
    canonical: "http://localhost/threads/7",
    robots: "index,follow",
    redirect: false,
    jsonLd: [],
  },
  node: { id: 2, title: "Garden" },
  watching: null,
  tags: [],
  poll: { exists: false, canAdd: false },
  featured: null,
  permissions: {
    canReply: true,
    canEditTitle: false,
    canEditTags: false,
    canModerate: false,
    canReport: true,
    canDelete: false,
    canLock: false,
    canHardDelete: false,
    canRemoveCover: false,
    canWatch: true,
  },
  resolvedPermissions: { "forum.undelete": true },
};
const held = { id: 31, mark: 25 };

// The backend answers each path with what the test says; every request is kept.
function backend(posts: Response | (() => Response)) {
  const asked: { method: string; path: string; search: string }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const { pathname, search } = new URL(url);
    asked.push({ method: init.method ?? "GET", path: pathname, search });
    if (pathname === "/api/v1/threads/7/posts") {
      return typeof posts === "function" ? posts() : posts.clone();
    }
    if (pathname === "/api/v1/me") return Response.json(viewerBody(true));
    if (pathname === "/api/v1/reaction-types") {
      return Response.json({ items: [] });
    }
    if (pathname === "/api/v1/member-authors") {
      return Response.json({ items: [] });
    }
    if (pathname === "/api/v1/bookmarks/status") {
      return Response.json({ bookmarked: [] });
    }
    if (pathname === "/api/v1/threads/7") return Response.json(threadBody);
    if (pathname === "/api/v1/threads/7/read") {
      return Response.json({ readPosition: 27 });
    }
    return Response.json(
      { error: { code: "not_found", message: pathname } },
      { status: 404 },
    );
  }) as unknown as typeof fetch;
  return asked;
}

const page = (over: Record<string, unknown>) =>
  Response.json({ items: [], nextCursor: null, afterPostId: 31, ...over });
const refusal = (status: number, code: string) =>
  Response.json({ error: { code, message: code } }, { status });

test("a poll with nothing new is one backend request, after the held position", async () => {
  const asked = backend(page({}));
  expect(await pollPosts(7, held)).toEqual({ rows: [] });
  expect(asked).toEqual([
    {
      method: "GET",
      path: "/api/v1/threads/7/posts",
      search: "?afterPosition=25",
    },
  ]);
});

test("new replies are drawn as rows ordered by position, and the thread is marked read up to them", async () => {
  const asked = backend(
    page({
      items: [
        postBody({ id: 32, position: 26 }),
        postBody({ id: 33, position: 27 }),
      ],
    }),
  );
  const answer = await pollPosts(7, held);
  expect(
    "rows" in answer && answer.rows.map((row) => [row.key, row.id, row.mark]),
  ).toEqual([
    ["post-32", 32, 26],
    ["post-33", 33, 27],
  ]);
  // How the rows are drawn comes from the thread, read here without counting a view.
  const thread = asked.find((request) => request.path === "/api/v1/threads/7");
  expect(thread?.search).toContain("countView=false");
  const read = asked.find(
    (request) => request.path === "/api/v1/threads/7/read",
  );
  expect(read?.method).toBe("PUT");
});

test("a different post at the held position means the thread is drawn again, and the replies are not used", async () => {
  backend(
    page({ afterPostId: 40, items: [postBody({ id: 32, position: 26 })] }),
  );
  expect(await pollPosts(7, held)).toEqual({ reload: true });
});

test("no post at the held position (it was removed or hidden) is a reload too", async () => {
  backend(page({ afterPostId: null }));
  expect(await pollPosts(7, held)).toEqual({ reload: true });
});

test("a missing afterPostId is a reload, never taken for a match", async () => {
  backend(Response.json({ items: [], nextCursor: null }));
  expect(await pollPosts(7, held)).toEqual({ reload: true });
});

test("a thread that is gone, or a session that ended, stops polling", async () => {
  backend(refusal(404, "not_found"));
  expect(await pollPosts(7, held)).toEqual({ stop: true });
  backend(refusal(401, "unauthenticated"));
  expect(await pollPosts(7, held)).toEqual({ stop: true });
});

test("a rate limit or a failure is raised, so the poll backs off", async () => {
  backend(refusal(429, "rate_limited"));
  await expect(pollPosts(7, held)).rejects.toThrow();
  backend(refusal(500, "internal"));
  await expect(pollPosts(7, held)).rejects.toThrow();
});

test("an id that cannot be a record never reaches the backend", async () => {
  const asked = backend(page({}));
  await expect(pollPosts(0, held)).rejects.toThrow();
  await expect(pollPosts(7, { id: 0, mark: 1 })).rejects.toThrow();
  expect(asked).toHaveLength(0);
});
