import { expect, test } from "bun:test";
import { bookmarkHref } from "./bookmark-list";

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
  }) as Parameters<typeof bookmarkHref>[0];

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
