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
const { default: CreditsPage } = await import("./page");

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

// Only the member list is answered; the rest of the page fails on its own and is not looked at.
function backend(members: unknown[]) {
  const asked: string[] = [];
  globalThis.fetch = (async (url: string) => {
    const { pathname, search } = new URL(url);
    if (pathname === "/api/v1/me") return Response.json(viewerBody(false));
    if (pathname === "/api/v1/members") {
      asked.push(search);
      return Response.json({ items: members, nextCursor: null, total: null });
    }
    return Response.json(
      { error: { code: "not_found", message: "?" } },
      { status: 404 },
    );
  }) as unknown as typeof fetch;
  return asked;
}

async function page() {
  const stream = await renderToReadableStream(
    withIntl(
      await CreditsPage({
        params: Promise.resolve({ locale: "en" }),
        searchParams: Promise.resolve({}),
      }),
    ),
    { onError: () => {} },
  );
  await stream.allReady;
  return new Response(stream).text();
}

test("the richest members are the ones who hold credits", async () => {
  const asked = backend([member(7)]);
  const html = await page();
  expect(html).toContain(messages.credits.credits.leadersHeading);
  expect(html).toContain("member7");
  expect(asked).toHaveLength(1);
  expect(asked[0]).toContain("sort=credits");
  expect(asked[0]).toContain("ranked=true");
});

test("nobody holds a credit: the ranking card is left out", async () => {
  backend([]);
  expect(await page()).not.toContain(messages.credits.credits.leadersHeading);
});
