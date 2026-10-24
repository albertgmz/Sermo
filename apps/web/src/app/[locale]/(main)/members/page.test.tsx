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

function backend(members: unknown[], total = members.length) {
  globalThis.fetch = (async (url: string) => {
    const { pathname } = new URL(url);
    if (pathname === "/api/v1/me") return Response.json(viewerBody(false));
    if (pathname === "/api/v1/members")
      return Response.json({ items: members, nextCursor: null, total });
    return Response.json(
      { error: { code: "not_found", message: "?" } },
      { status: 404 },
    );
  }) as unknown as typeof fetch;
}

async function page(
  params: Record<string, string>,
  onError: (error: unknown) => void = () => {},
) {
  const stream = await renderToReadableStream(
    withIntl(
      await MembersPage({
        params: Promise.resolve({ locale: "en" }),
        searchParams: Promise.resolve(params),
      } as never),
    ),
    { onError },
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

test("a ranking page past the last one goes to the last one, not to an empty state", async () => {
  backend([], 45);
  const errors: { digest?: string }[] = [];
  await page({ view: "credits", page: "9" }, (error) =>
    errors.push(error as { digest?: string }),
  );
  expect(errors).toHaveLength(1);
  expect(errors[0]?.digest).toContain(";/members?view=credits&page=3;");
});

test("the pages of a ranking are plain links that keep the view", async () => {
  backend([member(7)], 45);
  const html = await page({ view: "credits", page: "2" });
  expect(html).toContain('aria-current="page"');
  expect(html).toContain('href="/members?view=credits&amp;page=3"');
  expect(html).toContain('href="/members?view=credits"');
  expect(html).not.toContain("cursor=");
});

test("the pages of the directory are plain links that keep the sort", async () => {
  backend([member(7)], 45);
  const html = await page({ view: "all", sort: "posts", page: "2" });
  expect(html).toContain('href="/members?view=all&amp;sort=posts&amp;page=3"');
  expect(html).toContain('href="/members?view=all&amp;sort=posts"');
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
