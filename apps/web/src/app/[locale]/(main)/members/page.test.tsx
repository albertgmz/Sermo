import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { translator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));

const { viewerOfRequest } = await import("@/lib/sermo/client");
const { default: MembersPage } = await import("./page");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
});
beforeEach(() => {
  mock.module("@/lib/sermo/session", () => ({ getViewer: viewerOfRequest }));
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const member = (id: number) => ({
  card: {
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
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  postCount: 0,
  reactionScore: 0,
  awardXp: 0,
  credits: 90,
  awardCount: 0,
  referralCount: 0,
});

function backend(members: unknown[], nextCursor: string | null = null) {
  globalThis.fetch = (async (url: string) => {
    const { pathname } = new URL(url);
    if (pathname === "/api/v1/me") return Response.json(viewerBody(false));
    if (pathname === "/api/v1/members")
      return Response.json({ items: members, nextCursor });
    return Response.json(
      { error: { code: "not_found", message: "?" } },
      { status: 404 },
    );
  }) as unknown as typeof fetch;
}

async function page(params: Record<string, string>) {
  const stream = await renderToReadableStream(
    withIntl(
      await MembersPage({
        params: Promise.resolve({ locale: "en" }),
        searchParams: Promise.resolve(params),
      } as never),
    ),
    { onError: () => {} },
  );
  await stream.allReady;
  return new Response(stream).text();
}

const emptyTitle = messages.members.members.rankingEmptyTitle;

test("a ranking nobody is on says so", async () => {
  backend([]);
  expect(await page({ view: "credits" })).toContain(emptyTitle);
});

test("a ranking with members has no empty state", async () => {
  backend([member(7)]);
  expect(await page({ view: "credits" })).not.toContain(emptyTitle);
});

test("a first page that is empty while the backend has more is not an empty ranking", async () => {
  backend([], "c1");
  expect(await page({ view: "credits" })).not.toContain(emptyTitle);
});

test("a page after the first that holds nobody is not the empty state either", async () => {
  backend([]);
  expect(await page({ view: "credits", cursor: "21.c1" })).not.toContain(
    emptyTitle,
  );
});

test("the old address of the month's standing goes to its own page, keeping the rest of the query", async () => {
  backend([]);
  const redirected = await page({
    view: "month",
    month: "2025-06",
    cursor: "21.c1",
  }).then(
    () => null,
    (error: { digest?: string }) => error.digest ?? "",
  );
  expect(redirected).toContain("/members/month?month=2025-06&cursor=21.c1");
  expect(redirected).not.toContain("view=");
});
