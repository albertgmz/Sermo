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

const context = {
  threadAuthorId: 3,
  may: {} as never,
  canQuote: true,
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
  expect(await pollPosts(7, context, held)).toEqual({ rows: [] });
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
  const answer = await pollPosts(7, context, held);
  expect(
    "rows" in answer && answer.rows.map((row) => [row.key, row.id, row.mark]),
  ).toEqual([
    ["post-32", 32, 26],
    ["post-33", 33, 27],
  ]);
  const read = asked.find(
    (request) => request.path === "/api/v1/threads/7/read",
  );
  expect(read?.method).toBe("PUT");
});

test("a different post at the held position means the thread is drawn again, and the replies are not used", async () => {
  backend(
    page({ afterPostId: 40, items: [postBody({ id: 32, position: 26 })] }),
  );
  expect(await pollPosts(7, context, held)).toEqual({ reload: true });
});

test("no post at the held position (it was removed or hidden) is a reload too", async () => {
  backend(page({ afterPostId: null }));
  expect(await pollPosts(7, context, held)).toEqual({ reload: true });
});

test("a missing afterPostId is a reload, never taken for a match", async () => {
  backend(Response.json({ items: [], nextCursor: null }));
  expect(await pollPosts(7, context, held)).toEqual({ reload: true });
});

test("a thread that is gone, or a session that ended, stops polling", async () => {
  backend(refusal(404, "not_found"));
  expect(await pollPosts(7, context, held)).toEqual({ stop: true });
  backend(refusal(401, "unauthenticated"));
  expect(await pollPosts(7, context, held)).toEqual({ stop: true });
});

test("a rate limit or a failure is raised, so the poll backs off", async () => {
  backend(refusal(429, "rate_limited"));
  await expect(pollPosts(7, context, held)).rejects.toThrow();
  backend(refusal(500, "internal"));
  await expect(pollPosts(7, context, held)).rejects.toThrow();
});

test("an id that cannot be a record never reaches the backend", async () => {
  const asked = backend(page({}));
  await expect(pollPosts(0, context, held)).rejects.toThrow();
  await expect(pollPosts(7, context, { id: 0, mark: 1 })).rejects.toThrow();
  expect(asked).toHaveLength(0);
});
