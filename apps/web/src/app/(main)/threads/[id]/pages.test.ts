import { expect, test } from "bun:test";
import { POSTS_PER_PAGE } from "@/lib/sermo/page-sizes";
import { pageOf, postPermalink, threadHref } from "./pages";

test("a permalink is relative to the page being read and names the post's own page", () => {
  expect(postPermalink(0, 5)).toBe("?#post-5");
  expect(postPermalink(POSTS_PER_PAGE - 1, 9)).toBe("?#post-9");
  expect(postPermalink(POSTS_PER_PAGE, 43)).toBe("?page=2#post-43");
  expect(postPermalink(POSTS_PER_PAGE * 2 + 3, 77)).toBe("?page=3#post-77");
});

test("a permalink resolves to the thread's own address, whatever slug the visitor came by", () => {
  const here = "https://x.test/threads/7-slug?page=2#post-45";
  expect(new URL(postPermalink(POSTS_PER_PAGE, 43), here).href).toBe(
    "https://x.test/threads/7-slug?page=2#post-43",
  );
  expect(new URL(postPermalink(0, 1), here).href).toBe(
    "https://x.test/threads/7-slug?#post-1",
  );
});

test("the share address agrees with the permalink on the page", () => {
  const position = POSTS_PER_PAGE + 4;
  expect(threadHref(7, position, 43)).toBe(
    `/threads/7${postPermalink(position, 43)}`,
  );
  expect(pageOf(position)).toBe(2);
});
