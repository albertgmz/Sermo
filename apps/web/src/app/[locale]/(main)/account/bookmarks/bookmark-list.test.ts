import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { translator, withIntl } from "@/lib/test-intl";
import { withQuery } from "@/lib/test-query";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
const { createTranslator } = await import("use-intl");
const { messages } = await import("@/i18n/messages");
// The `details` line takes tags (t.rich): the shared translator leaves them unfilled, so the
// server translations here come from the real translator over the message files.
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) =>
    namespace === "account.bookmarks"
      ? createTranslator({ locale: "en", messages, namespace } as never)
      : translator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  usePathname: () => "/account/bookmarks",
  useRouter: () => ({
    refresh() {},
    push() {},
    replace() {},
    back() {},
    forward() {},
    prefetch() {},
  }),
  useSearchParams: () => new URLSearchParams(),
}));
// Another suite replaces the translator with one that fills no placeholders: use the real one.
const nextIntl = { ...(await import("next-intl")) };
const { useTranslations } = await import("use-intl");
mock.module("next-intl", () => ({
  ...nextIntl,
  useLocale: () => "en",
  useTranslations,
}));

const { viewerOfRequest } = await import("@/lib/sermo/client");
const { BookmarkList } = await import("./bookmark-list");
const { bookmarkHref } = await import("./bookmark-page");

afterAll(() => {
  mock.module("next/navigation", () => navigation);
  mock.module("next-intl", () => nextIntl);
  mock.module("next-intl/server", () => intl);
});
beforeEach(() => {
  mock.module("@/lib/sermo/session", () => ({ getViewer: viewerOfRequest }));
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const item = (fields: Record<string, unknown>) =>
  ({
    id: 1,
    contentType: "thread",
    contentId: 9,
    createdAt: "2026-01-01T00:00:00.000Z",
    title: "Title",
    threadId: 9,
    postPosition: null,
    author: { id: 1, username: "ana" },
    excerpt: "",
    ...fields,
  }) as never;

const rows = [
  item({ id: 1, title: "A thread" }),
  item({
    id: 2,
    contentType: "post",
    contentId: 40,
    title: "A post",
    postPosition: 0,
  }),
  item({
    id: 3,
    contentType: "conversation",
    contentId: 3,
    title: "A conversation",
    threadId: null,
  }),
];

function backend() {
  globalThis.fetch = (async (url: string) => {
    const { pathname } = new URL(url);
    if (pathname === "/api/v1/me") return Response.json(viewerBody(true));
    if (pathname === "/api/v1/bookmarks")
      return Response.json({ items: rows, nextCursor: null });
    if (pathname === "/api/v1/member-cards")
      return Response.json({ items: [] });
    return Response.json(
      { error: { code: "not_found", message: "?" } },
      { status: 404 },
    );
  }) as unknown as typeof fetch;
}

test("a bookmark leads to its thread, its post by position or its conversation", () => {
  expect(bookmarkHref(item({}))).toBe("/threads/9");
  expect(
    bookmarkHref(
      item({
        contentType: "post",
        contentId: 40,
        threadId: 9,
        postPosition: 0,
      }),
    ),
  ).toBe("/threads/9#post-40");
  expect(
    bookmarkHref(
      item({
        contentType: "post",
        contentId: 40,
        threadId: 9,
        postPosition: 55,
      }),
    ),
  ).toMatch(/^\/threads\/9\?page=\d+#post-40$/);
  expect(
    bookmarkHref(
      item({ contentType: "conversation", contentId: 3, threadId: null }),
    ),
  ).toBe("/conversations/3");
});

// The `details` line takes its author and time as tags: a function in their place is dropped by
// the renderer and rejected when a client component receives it.
test("every bookmark line shows its type, author and time", async () => {
  backend();
  const element = await BookmarkList({ searchParams: Promise.resolve({}) });
  const stream = await renderToReadableStream(withIntl(withQuery(element)));
  await stream.allReady;
  const html = await new Response(stream).text();
  for (const title of ["A thread", "A post", "A conversation"])
    expect(html).toContain(title);
  expect(html.match(/href="\/members\//g)).toHaveLength(3);
  expect(html.match(/<time /g)).toHaveLength(3);
  for (const type of ["Thread", "Post", "Conversation"])
    expect(html).toContain(`${type} by `);
});
