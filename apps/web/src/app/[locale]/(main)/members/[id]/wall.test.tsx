import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { profileCommentBody, profilePostBody } from "@/lib/test-bodies";
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

const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  usePathname: () => "/members/9",
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
const { Wall } = await import("./wall");

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

// A wall of 9 posts, ids 9 down to 1, three to a page: "p3" opens the page of 6, 5, 4 and "p6"
// the page of 3, 2, 1. Post 5 has five comments, ids 105 down to 101, two to a page, and shows
// the newest three.
const posts = Array.from({ length: 9 }, (_, i) => 9 - i);
const asked: string[] = [];
// The posts the fake backend says were edited.
let edited: number[] = [];

function comment(id: number) {
  return profileCommentBody({
    id,
    profilePostId: 5,
    bodyHtml: `<p>comment ${id}</p>`,
  });
}

function backend(signedIn = true) {
  asked.length = 0;
  edited = [];
  globalThis.fetch = (async (url: string) => {
    const { pathname, searchParams } = new URL(url);
    asked.push(`${pathname}?${searchParams}`);
    if (pathname === "/api/v1/me") return Response.json(viewerBody(signedIn));
    if (pathname === "/api/v1/reaction-types")
      return Response.json({ items: [] });
    if (pathname === "/api/v1/member-cards")
      return Response.json({ items: [] });
    if (pathname === "/api/v1/users/9/profile-posts") {
      const start = Number(searchParams.get("cursor")?.slice(1) ?? 0);
      const items = posts.slice(start, start + 3).map((id) =>
        profilePostBody({
          id,
          bodyHtml: `<p>wall post ${id}</p>`,
          editedAt: edited.includes(id) ? "2026-01-02T00:00:00.000Z" : null,
          commentCount: id === 5 ? 5 : 0,
          latestComments: id === 5 ? [105, 104, 103].map(comment) : [],
        }),
      );
      return Response.json({
        items,
        nextCursor: start + 3 < posts.length ? `p${start + 3}` : null,
      });
    }
    if (pathname === "/api/v1/profile-posts/5/comments") {
      const start = Number(searchParams.get("cursor")?.slice(1) ?? 0);
      const ids = [105, 104, 103, 102, 101];
      return Response.json({
        items: ids.slice(start, start + 2).map(comment),
        nextCursor: start + 2 < ids.length ? `c${start + 2}` : null,
      });
    }
    return Response.json(
      { error: { code: "not_found", message: "?" } },
      { status: 404 },
    );
  }) as unknown as typeof fetch;
}

async function wall(props: Record<string, unknown>) {
  const profile = { id: 9, username: "ember", canPostOnWall: false, card: {} };
  const element = await Wall({
    profile: profile as never,
    ...props,
  });
  const stream = await renderToReadableStream(withIntl(element));
  await stream.allReady;
  return new Response(stream).text();
}

const shows = (html: string, id: number) =>
  html.includes(`id="profile-post-${id}"`);

test("the wall opens at the first page when the address names no post", async () => {
  backend();
  const html = await wall({});
  expect([9, 8, 7].map((id) => shows(html, id))).toEqual([true, true, true]);
  expect(shows(html, 5)).toBe(false);
  expect(asked.filter((line) => line.includes("/profile-posts?"))).toHaveLength(
    1,
  );
});

test("a post that is not on the first page opens the wall at the page that holds it", async () => {
  backend();
  const html = await wall({ focus: { postId: 5 } });
  expect([6, 5, 4].map((id) => shows(html, id))).toEqual([true, true, true]);
  expect([9, 8, 7, 3].map((id) => shows(html, id))).toEqual([
    false,
    false,
    false,
    false,
  ]);
  // It continues from there: the link for more points at the page after.
  expect(html.includes('href="/members/9?cursor=p6"')).toBe(true);
});

test("a post on the first page is found with one read", async () => {
  backend();
  const html = await wall({ focus: { postId: 8 } });
  expect(shows(html, 8)).toBe(true);
  expect(
    asked.filter((line) => line.includes("/users/9/profile-posts")),
  ).toHaveLength(1);
});

test("a post the wall does not hold leaves the wall at its first page, without reading it twice", async () => {
  backend();
  const html = await wall({ focus: { postId: 77 } });
  expect(shows(html, 9)).toBe(true);
  expect(shows(html, 5)).toBe(false);
  // The three pages of the wall, once each.
  expect(
    asked.filter((line) => line.includes("/users/9/profile-posts")),
  ).toHaveLength(3);
});

test("a guest gets the first page and nothing is walked", async () => {
  backend(false);
  const html = await wall({ focus: { postId: 5, commentId: 102 } });
  expect(shows(html, 9)).toBe(true);
  expect(shows(html, 5)).toBe(false);
  expect(
    asked.filter((line) => line.includes("/users/9/profile-posts")),
  ).toHaveLength(1);
});

test("a cursor in the address wins over the post it names", async () => {
  backend();
  const html = await wall({ cursor: "p6", focus: { postId: 5 } });
  expect([3, 2, 1].map((id) => shows(html, id))).toEqual([true, true, true]);
  expect(shows(html, 5)).toBe(false);
});

test("a comment among the newest few is shown with the post", async () => {
  backend();
  const html = await wall({ focus: { postId: 5, commentId: 104 } });
  expect(html.includes('id="profile-comment-104"')).toBe(true);
  expect(asked.some((line) => line.includes("/profile-posts/5/comments"))).toBe(
    false,
  );
});

test("an older comment opens the page of comments that holds it", async () => {
  backend();
  const html = await wall({ focus: { postId: 5, commentId: 102 } });
  expect(html.includes('id="profile-comment-102"')).toBe(true);
  expect(html.includes('id="profile-comment-103"')).toBe(true);
  expect(html.includes('id="profile-comment-105"')).toBe(false);
});

test("an edited wall post says so beside its time, and only that one", async () => {
  backend();
  edited = [8];
  const html = await wall({});
  expect(html.split("Edited ").length - 1).toBe(1);
});

test("the author's controls come from the backend's flags on each post", async () => {
  backend();
  const html = await wall({});
  // The fake backend allows nobody to edit or delete: a signed-in member sees share and report.
  expect(html).not.toContain('aria-label="Edit"');
  expect(html).not.toContain('aria-label="Delete"');
  expect(html).toContain('aria-label="Report"');
  expect(html).toContain('aria-label="Share"');
});
