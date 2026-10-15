import { afterEach, expect, mock, test } from "bun:test";

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
const { newFeedCount } = await import("./feed-actions");
const { viewerBody } = await import("@/lib/test-viewer");

afterEach(() => {
  globalThis.fetch = realFetch;
});

const SINCE = "2026-01-01T00:00:00.000Z";

function backend(answer: Response) {
  const asked: { path: string; search: string }[] = [];
  globalThis.fetch = (async (url: string) => {
    const { pathname, search } = new URL(url);
    asked.push({ path: pathname, search });
    return answer.clone();
  }) as unknown as typeof fetch;
  return asked;
}

test("the count is one request for the tab, since the newest entry held", async () => {
  const asked = backend(Response.json({ count: 4, more: false }));
  expect(await newFeedCount("latest", {}, SINCE)).toEqual({
    count: 4,
    more: false,
  });
  expect(asked).toHaveLength(1);
  expect(asked[0].path).toBe("/api/v1/feed/new-count");
  expect(new URLSearchParams(asked[0].search).get("scope")).toBe("latest");
  expect(new URLSearchParams(asked[0].search).get("since")).toBe(SINCE);
  await newFeedCount("following", {}, SINCE);
  expect(new URLSearchParams(asked[1].search).get("scope")).toBe("following");
});

test("a capped count says so", async () => {
  backend(Response.json({ count: 99, more: true }));
  expect(await newFeedCount("latest", {}, SINCE)).toEqual({
    count: 99,
    more: true,
  });
});

test("the ranked tab has nothing to poll and the backend is not asked", async () => {
  const asked = backend(Response.json({ count: 1, more: false }));
  expect(await newFeedCount("top", {}, SINCE)).toEqual({ stop: true });
  expect(await newFeedCount("anything", {}, SINCE)).toEqual({ stop: true });
  expect(asked).toHaveLength(0);
});

test("a session that ended stops polling; a rate limit is raised for the back-off", async () => {
  backend(
    Response.json(
      { error: { code: "unauthenticated", message: "no" } },
      { status: 401 },
    ),
  );
  expect(await newFeedCount("following", {}, SINCE)).toEqual({ stop: true });
  backend(
    Response.json(
      { error: { code: "rate_limited", message: "slow" } },
      { status: 429 },
    ),
  );
  await expect(newFeedCount("latest", {}, SINCE)).rejects.toThrow();
});

test("the filter goes to the backend with the poll, field by field", async () => {
  const asked = backend(Response.json({ count: 0, more: false }));
  await newFeedCount(
    "latest",
    { forumIds: [3, 4], prefixId: 2, tag: "rust", unread: true },
    SINCE,
  );
  const query = new URLSearchParams(asked[0].search);
  expect(query.getAll("forumIds")).toEqual(["3", "4"]);
  expect(query.get("prefixId")).toBe("2");
  expect(query.get("tag")).toBe("rust");
  expect(query.get("unread")).toBe("true");
  expect(query.get("watched")).toBeNull();
});

test("a page after the first is asked for with the filter the list was drawn with", async () => {
  const asked: { path: string; search: string }[] = [];
  globalThis.fetch = (async (url: string) => {
    const { pathname, search } = new URL(url);
    asked.push({ path: pathname, search });
    if (pathname === "/api/v1/me") return Response.json(viewerBody(false));
    return Response.json({ items: [], nextCursor: null });
  }) as unknown as typeof fetch;
  const { moreFeed } = await import("./feed-actions");
  const page = await moreFeed(
    "hot",
    { type: "sticky", watched: true, forumIds: [9] },
    "abc",
  );
  expect(page).toEqual({ rows: [], nextCursor: null });
  const feed = asked.find((entry) => entry.path === "/api/v1/feed");
  const query = new URLSearchParams(feed?.search);
  expect(query.get("scope")).toBe("hot");
  expect(query.get("cursor")).toBe("abc");
  expect(query.get("type")).toBe("sticky");
  expect(query.get("watched")).toBe("true");
  expect(query.getAll("forumIds")).toEqual(["9"]);
});
