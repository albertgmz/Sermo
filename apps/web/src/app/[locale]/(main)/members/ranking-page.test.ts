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
const { rankingPageAction, directoryPageAction } = await import(
  "./members-page-actions"
);

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

// The members list answers three members of a list of 45, whatever page is asked, and the visitor is
// a guest.
function backend() {
  const asked: string[] = [];
  globalThis.fetch = (async (url: string) => {
    const { pathname, search } = new URL(url);
    asked.push(`${pathname}${search}`);
    if (pathname === "/api/v1/me") return Response.json(viewerBody(false));
    return Response.json({
      items: [item(1), item(2), item(3)],
      nextCursor: null,
      total: 45,
    });
  }) as unknown as typeof fetch;
  return asked;
}

const ranks = (rows: { node: unknown }[]) =>
  rows.map((row) => (row.node as ReactElement<{ rank: number }>).props.rank);

test("the first page numbers its rows from one and says how many members the ranking holds", async () => {
  backend();
  const page = await rankingPage("posts", "posts", 1);
  expect(ranks(page.rows)).toEqual([1, 2, 3]);
  expect(page.rows.map((row) => row.key)).toEqual(["1", "2", "3"]);
  expect(page.total).toBe(45);
});

test("a page after the first continues the numbers and asks the backend for its own page", async () => {
  const asked = backend();
  const page = await rankingPage("posts", "posts", 3);
  expect(ranks(page.rows)).toEqual([41, 42, 43]);
  expect(asked.some((request) => request.includes("page=3"))).toBe(true);
  expect(asked.some((request) => request.includes("cursor="))).toBe(false);
});

test("the ranking asks for the members who scored only, the directory for everyone", async () => {
  const asked = backend();
  await rankingPage("credits", "credits", 1);
  await directoryPage("credits", 1);
  const [ranking, directory] = asked.filter((request) =>
    request.includes("/members?"),
  );
  expect(ranking).toContain("ranked=true");
  expect(directory).not.toContain("ranked");
});

test("the action that the browser calls draws the same page", async () => {
  backend();
  const drawn = (await rankingPageAction("posts", 2)) as ReactElement<{
    view: string;
    page: number;
    list: { rows: { node: unknown }[] };
  }>;
  expect(drawn.props.view).toBe("posts");
  expect(drawn.props.page).toBe(2);
  expect(ranks(drawn.props.list.rows)).toEqual([21, 22, 23]);
  const cards = (await directoryPageAction("newest", 2)) as ReactElement<{
    sort: string;
    page: number;
  }>;
  expect(cards.props.sort).toBe("newest");
  expect(cards.props.page).toBe(2);
});

test("a view that is not a ranking, or a sort that is not one, is no page and asks nothing", async () => {
  const asked = backend();
  expect(await rankingPageAction("overview", 2)).toBeNull();
  expect(await rankingPageAction("nonsense", 2)).toBeNull();
  expect(await directoryPageAction("password", 2)).toBeNull();
  expect(asked).toHaveLength(0);
});

test("a directory page is one row, keyed by its page so that two pages never share a key", async () => {
  backend();
  const first = await directoryPage("newest", 1);
  const second = await directoryPage("newest", 2);
  expect(first.rows).toHaveLength(1);
  expect(first.rows[0].key).not.toBe(second.rows[0].key);
  expect(first.total).toBe(45);
});
