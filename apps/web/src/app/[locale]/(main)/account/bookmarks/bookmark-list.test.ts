import { afterAll, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "use-intl";
import { messages } from "@/i18n/messages";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
const client = await import("@/lib/sermo/client");
const members = await import("@/lib/sermo/members");
const userLink = await import("@/components/forum/user-link");
const relativeTime = await import("@/components/forum/relative-time");
const bookmarkButton = await import("@/components/forum/bookmark-button");

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

mock.module("next-intl/server", () => ({
  getTranslations: async (namespace: string) =>
    createTranslator({ locale: "en", messages, namespace } as never),
}));
mock.module("@/lib/sermo/client", () => ({
  read: async () => ({ items: rows, nextCursor: null }),
}));
mock.module("@/lib/sermo/members", () => ({
  membersFor: async () => (id: number) => ({ id, username: "ana" }),
}));
mock.module("@/components/forum/user-link", () => ({
  UserLink: ({ user }: { user: { username: string } }) =>
    createElement("b", null, user.username),
}));
mock.module("@/components/forum/relative-time", () => ({
  RelativeTime: () => createElement("time", null, "2 days ago"),
}));
mock.module("@/components/forum/bookmark-button", () => ({
  BookmarkButton: () => null,
}));

const { BookmarkList, bookmarkHref } = await import("./bookmark-list");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("@/lib/sermo/client", () => client);
  mock.module("@/lib/sermo/members", () => members);
  mock.module("@/components/forum/user-link", () => userLink);
  mock.module("@/components/forum/relative-time", () => relativeTime);
  mock.module("@/components/forum/bookmark-button", () => bookmarkButton);
});

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

// The `details` line takes its author and time as elements: a function in their place is
// dropped by the renderer and rejected when a client component receives it.
test("every bookmark line shows its type, author and time", async () => {
  const html = renderToStaticMarkup(
    await BookmarkList({ searchParams: Promise.resolve({}) }),
  );
  expect(html.match(/<b>ana<\/b>/g)).toHaveLength(3);
  expect(html.match(/<time>2 days ago<\/time>/g)).toHaveLength(3);
  expect(html).toContain("by <b>ana</b>, <time>");
});
