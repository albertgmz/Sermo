import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { translator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const intlServer = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getFormatter: async () => ({ number: (value: number) => String(value) }),
  getTranslations: async (namespace: string) => translator(namespace),
}));
const intl = { ...(await import("next-intl")) };
const { useTranslations, useFormatter } = await import("use-intl");
mock.module("next-intl", () => ({
  ...intl,
  useLocale: () => "en",
  useTranslations,
  useFormatter,
}));

const { viewerOfRequest } = await import("@/lib/sermo/client");
const { FeedSidebar } = await import("./feed-sidebar");

afterAll(() => {
  mock.module("next-intl/server", () => intlServer);
  mock.module("next-intl", () => intl);
});
// Another test file leaves a stand-in for the viewer in place: the sidebar asks the backend.
beforeEach(() => {
  mock.module("@/lib/sermo/session", () => ({ getViewer: viewerOfRequest }));
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

// The backend refuses users.list to a viewer whose group lacks member.viewList; the other blocks
// of the sidebar have nothing to show.
function backend(members: () => Response) {
  globalThis.fetch = (async (url: string) => {
    const { pathname } = new URL(url);
    if (pathname === "/api/v1/me") return Response.json(viewerBody(false));
    if (pathname === "/api/v1/members") return members();
    return Response.json({ items: [], nextCursor: null });
  }) as unknown as typeof fetch;
}

async function sidebar() {
  const errors: unknown[] = [];
  const stream = await renderToReadableStream(withIntl(<FeedSidebar />), {
    onError: (error) => {
      errors.push(error);
    },
  });
  await stream.allReady;
  return { html: await new Response(stream).text(), errors };
}

test("a viewer who may not list members gets the sidebar without suggested members, and no error", async () => {
  backend(() =>
    Response.json(
      { error: { code: "forbidden", message: "Not for you." } },
      { status: 403 },
    ),
  );
  const { html, errors } = await sidebar();
  expect(errors).toEqual([]);
  expect(html).not.toContain(messages.home.feedSidebar.membersTitle);
});

test("a failure on the backend's side is still raised", async () => {
  backend(() =>
    Response.json(
      { error: { code: "internal", message: "Broken." } },
      { status: 500 },
    ),
  );
  const { errors } = await sidebar();
  expect(errors).not.toEqual([]);
});

test("the suggested members are there when the backend lists them", async () => {
  backend(() =>
    Response.json({
      items: [
        {
          card: {
            id: 7,
            username: "nova",
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
          credits: 0,
          awardCount: 0,
          referralCount: 0,
        },
      ],
      nextCursor: null,
    }),
  );
  const { html, errors } = await sidebar();
  expect(errors).toEqual([]);
  expect(html).toContain(messages.home.feedSidebar.membersTitle);
  expect(html).toContain("nova");
});

test("the ranked blocks ask for what the feed shows, so the forums left out of it stay out of them", async () => {
  const asked: URLSearchParams[] = [];
  globalThis.fetch = (async (url: string) => {
    const { pathname, searchParams } = new URL(url);
    if (pathname === "/api/v1/me") return Response.json(viewerBody(false));
    if (pathname === "/api/v1/thread-rankings") asked.push(searchParams);
    return Response.json({ items: [], nextCursor: null });
  }) as unknown as typeof fetch;
  await sidebar();
  expect(asked.map((query) => query.get("by")).sort()).toEqual([
    "latestThreads",
    "mostReacted",
  ]);
  expect(asked.every((query) => query.get("feed") === "true")).toBe(true);
});
