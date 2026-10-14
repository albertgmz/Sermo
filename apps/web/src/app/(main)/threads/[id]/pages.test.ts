import { expect, test } from "bun:test";
import { POSTS_PER_PAGE } from "@/lib/sermo/page-sizes";
import { pageOf, threadHref } from "./pages";

test("a post's address names its own page, with no query on the first", () => {
  expect(threadHref(7, 0, 5)).toBe("/threads/7#post-5");
  expect(threadHref(7, POSTS_PER_PAGE - 1, 9)).toBe("/threads/7#post-9");
  expect(threadHref(7, POSTS_PER_PAGE, 43)).toBe("/threads/7?page=2#post-43");
  expect(pageOf(POSTS_PER_PAGE * 2)).toBe(3);
});
