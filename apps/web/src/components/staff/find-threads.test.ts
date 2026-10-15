import { afterEach, expect, mock, test } from "bun:test";
import {
  fakeBackend,
  refusal,
} from "@/app/[locale]/(staff)/admin/groups/test-backend";
import { viewerBody } from "@/lib/test-viewer";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const { findThreads } = await import("./find-threads");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());

const when = "2026-01-01T00:00:00.000Z";
const someone = { id: 3, username: "ember" };
const hit = (threadId: number, title: string, postId: number) => ({
  post: {
    id: postId,
    position: 0,
    createdAt: when,
    author: someone,
    excerpt: "",
  },
  thread: {
    id: threadId,
    title,
    nodeId: 2,
    node: { id: 2, title: "Forum" },
    prefix: null,
  },
});

test("words are searched in titles, and a thread that matches through several posts is one choice", async () => {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(true)),
    "search.query": () =>
      Response.json({
        items: [
          hit(7, "Rules of the house", 70),
          hit(7, "Rules of the house", 71),
          hit(9, "House rules, again", 90),
        ],
        nextCursor: null,
      }),
  });
  expect(await findThreads("  rules house ")).toEqual([
    { id: 7, title: "Rules of the house" },
    { id: 9, title: "House rules, again" },
  ]);
  const asked = backend.asked.find((call) => call.operation === "search.query");
  expect(asked?.path).toContain("/search");
});

test("a number finds that thread, without counting a view", async () => {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(true)),
    "threads.get": () =>
      Response.json({
        thread: {
          id: 31,
          nodeId: 2,
          node: { id: 2, title: "Forum" },
          title: "Rules of the house",
          prefix: null,
          excerpt: "",
          cover: null,
          highlightedUntil: null,
          bumpedAt: null,
          author: someone,
          state: "visible",
          isSticky: false,
          isLocked: false,
          createdAt: when,
          replyCount: 0,
          viewCount: 0,
          firstPostId: 1,
          lastPost: { postId: 1, position: 0, postedAt: when, user: someone },
          readPosition: null,
          isUnread: false,
        },
        seo: {
          title: "t",
          description: "d",
          canonical: "https://example.test/threads/31",
          robots: "index,follow",
          redirect: false,
          jsonLd: [],
        },
        node: { id: 2, title: "Forum" },
        watching: null,
        tags: [],
        featured: null,
        permissions: {
          canReply: false,
          canEditTitle: false,
          canEditTags: false,
          canModerate: false,
          canReport: false,
          canDelete: false,
          canLock: false,
          canHardDelete: false,
          canRemoveCover: false,
          canWatch: false,
        },
        resolvedPermissions: {},
      }),
  });
  expect(await findThreads("31")).toEqual([
    { id: 31, title: "Rules of the house" },
  ]);
  expect(backend.asked.map((call) => call.operation)).not.toContain(
    "search.query",
  );
  expect(
    backend.asked.find((call) => call.operation === "threads.get")?.path,
  ).toBe("/api/v1/threads/31");
});

test("a thread that cannot be found, or a search that is refused, finds nothing", async () => {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(true)),
    "threads.get": () => refusal(404, "not_found", "No."),
    "search.query": () => refusal(429, "rate_limited", "Slow down."),
  });
  expect(await findThreads("404")).toEqual([]);
  expect(await findThreads("anything")).toEqual([]);
});
