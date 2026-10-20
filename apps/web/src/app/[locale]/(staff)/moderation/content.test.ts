import { afterEach, expect, mock, test } from "bun:test";
import {
  postBody,
  profileCommentBody,
  profilePostBody,
} from "@/lib/test-bodies";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));

const { describe, plainExcerpt } = await import("./content");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("the excerpt is the text of the HTML, without tags or markup entities", () => {
  expect(
    plainExcerpt("<p>Fish &amp; <strong>chips</strong></p><p>tonight</p>"),
  ).toBe("Fish & chips tonight");
});

test("a long text is cut at the length with an ellipsis", () => {
  const cut = plainExcerpt(`<p>${"word ".repeat(100)}</p>`, 20);
  expect(cut.endsWith("…")).toBe(true);
  expect(cut.length).toBeLessThanOrEqual(21);
});

test("a reported post, wall post or comment links to the page that holds it, at the item", async () => {
  globalThis.fetch = (async (url: string) => {
    const { pathname } = new URL(url);
    if (pathname === "/api/v1/posts/31")
      return Response.json(postBody({ id: 31, threadId: 7, position: 45 }));
    if (pathname === "/api/v1/profile-posts/12")
      return Response.json(profilePostBody({ id: 12, profileUserId: 5 }));
    if (pathname === "/api/v1/profile-comments/80")
      return Response.json(profileCommentBody({ id: 80, profilePostId: 12 }));
    return Response.json(
      { error: { code: "not_found", message: "?" } },
      { status: 404 },
    );
  }) as unknown as typeof fetch;
  expect((await describe("post", 31)).href).toBe("/threads/7?page=3#post-31");
  expect((await describe("profile_post", 12)).href).toBe(
    "/members/5?post=12#profile-post-12",
  );
  expect((await describe("profile_post_comment", 80)).href).toBe(
    "/members/5?post=12&comment=80#profile-comment-80",
  );
});
