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
const { replyInPlace } = await import("./reply-in-place");

beforeEach(() => {
  mock.module("@/lib/sermo/session", () => ({ getViewer: viewerOfRequest }));
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const form = (body: string) => {
  const data = new FormData();
  data.set("body", body);
  return data;
};

// The reply is saved; reading the thread to draw it fails (or not).
function backend(threadRead: Response) {
  const saved: string[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const { pathname } = new URL(url);
    if (pathname === "/api/v1/threads/7/posts" && init.method === "POST") {
      saved.push(String(init.body));
      return Response.json(postBody({ id: 40, position: 26 }), { status: 201 });
    }
    if (pathname === "/api/v1/me") return Response.json(viewerBody(true));
    if (pathname === "/api/v1/reaction-types")
      return Response.json({ items: [] });
    if (pathname === "/api/v1/member-authors")
      return Response.json({ items: [] });
    if (pathname === "/api/v1/bookmarks/status") {
      return Response.json({ bookmarked: [] });
    }
    if (pathname === "/api/v1/threads/7") return threadRead.clone();
    return Response.json(
      { error: { code: "not_found", message: pathname } },
      { status: 404 },
    );
  }) as unknown as typeof fetch;
  return saved;
}

test("a reply that is saved but cannot be drawn counts as sent, so the form does not keep the text for a second press", async () => {
  const saved = backend(
    Response.json(
      { error: { code: "internal", message: "down" } },
      { status: 500 },
    ),
  );
  const answer = await replyInPlace(7, form("hello"));
  expect(answer).toEqual({});
  expect(saved).toHaveLength(1);
});

test("a refused reply is still a refusal", async () => {
  globalThis.fetch = (async () =>
    Response.json(
      { error: { code: "forbidden", message: "Locked." } },
      { status: 403 },
    )) as unknown as typeof fetch;
  expect(await replyInPlace(7, form("hello"))).toEqual({ error: "Locked." });
});
