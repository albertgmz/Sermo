import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string) => key,
}));
const { viewerOfRequest } = await import("@/lib/sermo/client");
const { rankingPage } = await import("./ranking-page");
const { directoryPage } = await import("./directory-page");
const { moreRanking, moreDirectory } = await import("./more-members");

beforeEach(() => {
  mock.module("@/lib/sermo/session", () => ({ getViewer: viewerOfRequest }));
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const card = (id: number) => ({
  id,
  username: `member${id}`,
  avatar: null,
  frame: null,
  nameColor: null,
  nameIcon: null,
  title: "",
  badges: [],
  level: 1,
  restricted: false,
});
const item = (id: number) => ({
  card: card(id),
  createdAt: "2026-01-01T00:00:00.000Z",
  postCount: id,
  reactionScore: 0,
  awardXp: 0,
  credits: 0,
  awardCount: 0,
  referralCount: 0,
});

// The directory answers three members per page, whatever is asked, and the visitor is a guest.
function backend() {
  const asked: string[] = [];
  globalThis.fetch = (async (url: string) => {
    const { pathname, search } = new URL(url);
    asked.push(`${pathname}${search}`);
    if (pathname === "/api/v1/me") return Response.json(viewerBody(false));
    const cursor = new URLSearchParams(search).get("cursor");
    const first = cursor === null ? 1 : Number(cursor.replace("c", "")) * 3 + 1;
    return Response.json({
      items: [item(first), item(first + 1), item(first + 2)],
      nextCursor: `c${(cursor === null ? 0 : Number(cursor.replace("c", ""))) + 1}`,
    });
  }) as unknown as typeof fetch;
  return asked;
}

const ranks = (rows: { node: unknown }[]) =>
  rows.map((row) => (row.node as ReactElement<{ rank: number }>).props.rank);

test("the first page numbers its rows from one and hands on the rank of the next", async () => {
  backend();
  const page = await rankingPage("posts", "posts");
  expect(ranks(page.rows)).toEqual([1, 2, 3]);
  expect(page.rows.map((row) => row.key)).toEqual(["1", "2", "3"]);
  expect(page.nextCursor).toBe("4.c1");
});

test("the page after it continues the numbers and asks the backend for its own cursor", async () => {
  const asked = backend();
  const page = await rankingPage("posts", "posts", "4.c1");
  expect(ranks(page.rows)).toEqual([4, 5, 6]);
  expect(page.nextCursor).toBe("7.c2");
  expect(asked.some((request) => request.includes("cursor=c1"))).toBe(true);
  expect(asked.some((request) => request.includes("cursor=4"))).toBe(false);
});

test("the action that the browser calls draws the same page", async () => {
  backend();
  const page = await moreRanking("posts", "4.c1");
  expect(ranks(page.rows)).toEqual([4, 5, 6]);
});

test("a view that is not a ranking, or a sort that is not one, is an empty page and asks nothing", async () => {
  const asked = backend();
  expect(await moreRanking("overview", null)).toEqual({
    rows: [],
    nextCursor: null,
  });
  expect(await moreRanking("nonsense", null)).toEqual({
    rows: [],
    nextCursor: null,
  });
  expect(await moreDirectory("password", null)).toEqual({
    rows: [],
    nextCursor: null,
  });
  expect(asked).toHaveLength(0);
});

test("a directory page is one row, keyed by its cursor so that two pages never share a key", async () => {
  backend();
  const first = await directoryPage("newest");
  const second = await directoryPage("newest", "c1");
  expect(first.rows).toHaveLength(1);
  expect(first.rows[0].key).not.toBe(second.rows[0].key);
  expect(first.nextCursor).toBe("c1");
});
