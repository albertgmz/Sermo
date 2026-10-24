import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, prefetch() {} }),
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
const { moreWall } = await import("./more-wall");

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
// The posts the fake backend says two members reacted to, with its one reaction type.
let reacted: number[] = [];
// The posts the fake backend says were deleted, and what the viewer may do about them.
let deleted: number[] = [];
let viewerCan: Record<string, boolean> = {};
const like = {
  id: 1,
  title: "Like",
  emoji: "L",
  score: 1,
  position: 0,
  isActive: true,
  image: null,
  frames: null,
  forumIds: [],
  hideWhenLocked: false,
  rule: null,
  access: "open",
  lockHint: null,
};

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
  reacted = [];
  deleted = [];
  viewerCan = {};
  globalThis.fetch = (async (url: string) => {
    const { pathname, searchParams } = new URL(url);
    asked.push(`${pathname}?${searchParams}`);
    if (pathname === "/api/v1/me")
      return Response.json({
        ...viewerBody(signedIn),
        resolvedPermissions: viewerCan,
      });
    if (pathname === "/api/v1/reaction-types")
      return Response.json({ items: reacted.length > 0 ? [like] : [] });
    if (pathname === "/api/v1/member-cards")
      return Response.json({ items: [] });
    if (pathname === "/api/v1/users/9/profile-posts") {
      const start = Number(searchParams.get("cursor")?.slice(1) ?? 0);
      const items = posts.slice(start, start + 3).map((id) =>
        profilePostBody({
          id,
          bodyHtml: `<p>wall post ${id}</p>`,
          editedAt: edited.includes(id) ? "2026-01-02T00:00:00.000Z" : null,
          state: deleted.includes(id) ? "deleted" : "visible",
          deletion: deleted.includes(id)
            ? {
                by: { id: 4, username: "kestrel" },
                reason: "Spam",
                at: "2026-01-02T00:00:00.000Z",
              }
            : null,
          reactions: reacted.includes(id)
            ? { counts: { "1": 2 }, total: 2, mine: null }
            : { counts: {}, total: 0, mine: null },
          commentCount: id === 5 ? 5 : 0,
          latestComments: id === 5 ? [105, 104, 103].map(comment) : [],
        }),
      );
      return Response.json({
        items,
        nextCursor: start + 3 < posts.length ? `p${start + 3}` : null,
      });
    }
    // Where the backend places a post: its wall, and the cursor of the page of three that holds it.
    const placed = /^\/api\/v1\/profile-posts\/(\d+)\/location$/.exec(pathname);
    if (placed) {
      const id = Number(placed[1]);
      // Post 40 is on another member's wall.
      if (id === 40)
        return Response.json({
          profilePostId: id,
          profileUserId: 4,
          cursor: null,
        });
      const index = posts.indexOf(id);
      if (index !== -1)
        return Response.json({
          profilePostId: id,
          profileUserId: 9,
          cursor: index < 3 ? null : `p${index - (index % 3)}`,
        });
    }
    const placedComment = /^\/api\/v1\/profile-comments\/(\d+)\/location$/.exec(
      pathname,
    );
    if (placedComment) {
      const id = Number(placedComment[1]);
      const index = [105, 104, 103, 102, 101].indexOf(id);
      if (index !== -1)
        return Response.json({
          commentId: id,
          profilePostId: 5,
          profileUserId: 9,
          wallCursor: "p3",
          commentsCursor: index < 2 ? null : `c${index - (index % 2)}`,
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
  // The posts are rows of the shared list, which keeps its pages in the query client.
  const stream = await renderToReadableStream(
    withIntl(
      <QueryClientProvider client={new QueryClient()}>
        {element}
      </QueryClientProvider>,
    ),
  );
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

test("a post on the first page is found with one read of the wall", async () => {
  backend();
  const html = await wall({ focus: { postId: 8 } });
  expect(shows(html, 8)).toBe(true);
  expect(
    asked.filter((line) => line.includes("/users/9/profile-posts")),
  ).toHaveLength(1);
});

test("a guest's address opens the page that holds the post too", async () => {
  backend(false);
  const html = await wall({ focus: { postId: 2 } });
  expect([3, 2, 1].map((id) => shows(html, id))).toEqual([true, true, true]);
  expect(shows(html, 9)).toBe(false);
});

test("a post the backend cannot place leaves the wall at its first page, read once", async () => {
  backend();
  const html = await wall({ focus: { postId: 77 } });
  expect(shows(html, 9)).toBe(true);
  expect(shows(html, 5)).toBe(false);
  expect(
    asked.filter((line) => line.includes("/users/9/profile-posts")),
  ).toHaveLength(1);
});

test("a post on another member's wall leaves the wall at its first page", async () => {
  backend(false);
  const html = await wall({ focus: { postId: 40 } });
  expect(shows(html, 9)).toBe(true);
  expect(shows(html, 40)).toBe(false);
});

test("a cursor in the address wins over the post it names", async () => {
  backend();
  const html = await wall({ cursor: "p6", focus: { postId: 5 } });
  expect([3, 2, 1].map((id) => shows(html, id))).toEqual([true, true, true]);
  expect(shows(html, 5)).toBe(false);
  expect(asked.some((line) => line.includes("/location"))).toBe(false);
});

test("a comment among the newest few is shown with the post", async () => {
  backend();
  const html = await wall({ focus: { postId: 5, commentId: 104 } });
  expect(html.includes('id="profile-comment-104"')).toBe(true);
  expect(asked.some((line) => line.includes("/profile-posts/5/comments"))).toBe(
    false,
  );
});

test("an older comment opens the page of comments that holds it, for a guest as well", async () => {
  for (const signedIn of [true, false]) {
    backend(signedIn);
    const html = await wall({ focus: { postId: 5, commentId: 101 } });
    expect(html.includes('id="profile-comment-101"')).toBe(true);
    expect(html.includes('id="profile-comment-103"')).toBe(false);
    expect(
      asked.filter((line) => line.includes("/profile-posts/5/comments")),
    ).toEqual(["/api/v1/profile-posts/5/comments?cursor=c4"]);
  }
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
  // The fake backend allows nobody to edit or delete: a signed-in member sees share and report,
  // and no "•••" menu with nothing in it.
  expect(html).not.toContain('aria-label="Edit"');
  expect(html).not.toContain('aria-label="Delete"');
  expect(html).toContain('aria-label="Report"');
  expect(html).toContain('aria-label="Share"');
  expect(html).not.toContain('aria-label="More options"');
});

test("who reacted to a post heads its block of comments; with no block it sits under the bar", async () => {
  backend();
  reacted = [5, 8];
  const html = await wall({ cursor: "p3" });
  const summary = (from: number) =>
    html.indexOf("2 reactions, show who reacted", from);
  // Post 5 has comments: its summary is the block's first row, before the oldest comment.
  const five = html.indexOf('id="profile-post-5"');
  expect(summary(five)).toBeLessThan(html.indexOf("comment 103", five));
  expect(html.slice(five, summary(five))).toContain("py-0.5 empty:hidden");
  // Post 8 has none and cannot be commented on: the summary follows its bar.
  const page = await wall({});
  const eight = page.indexOf('id="profile-post-8"');
  const at = page.indexOf("2 reactions, show who reacted", eight);
  expect(at).toBeGreaterThan(eight);
  expect(at).toBeLessThan(page.indexOf('id="profile-post-7"'));
  expect(page.slice(eight, at)).not.toContain("py-0.5 empty:hidden");
});

test("on a phone a wall post's one avatar sits small in its header, so the comments span the post", async () => {
  backend();
  const html = await wall({ cursor: "p3" });
  const five = html.slice(
    html.indexOf('id="profile-post-5"'),
    html.indexOf('id="profile-post-5-comment"') > -1
      ? html.indexOf('id="profile-post-5-comment"')
      : html.indexOf('id="profile-post-4"'),
  );
  const head = five.slice(0, five.indexOf("wall post 5"));
  // One avatar of the author, 24 px below md and 40 px from md up, spanning the header and body
  // rows there; the body column spans both columns below md.
  expect(head.match(/href="\/members\/3"/g)).toHaveLength(2);
  expect(head).toContain("size-6 md:size-10");
  expect(head).toContain("md:row-span-2");
  expect(head).toContain("col-span-2 min-w-0 md:col-span-1 md:col-start-2");
});

test("a deleted wall post is folded to its author, time and notice, its comments with it", async () => {
  backend();
  deleted = [5];
  viewerCan = { "profilePost.undelete": true, "profilePost.hardDelete": true };
  const html = await wall({ cursor: "p3" });
  const five = html.indexOf('id="profile-post-5"');
  const four = html.indexOf('id="profile-post-4"');
  const folded = html.slice(five, four);
  expect(folded).not.toContain("wall post 5");
  expect(folded).not.toContain("comment 103");
  expect(folded).toContain("Deleted by kestrel");
  expect(folded).toContain("Reason: Spam");
  expect(folded).toMatch(/aria-expanded="false"[^>]*>Show…</);
  expect(folded).toContain(">Restore<");
  expect(folded).toContain('aria-label="Delete permanently"');
  // The others are drawn in full.
  expect(html).toContain("wall post 4");

  backend();
  deleted = [5];
  const member = await wall({ cursor: "p3" });
  expect(member).not.toContain(">Restore<");
  expect(member).not.toContain("Delete permanently");
});

test("Load more on the wall is the shared list's button, which puts the next posts under those shown", async () => {
  backend();
  const html = await wall({});
  // Without scripts the button is a link to the page after; with them it loads that page in place.
  const more = html.match(/<a href="\/members\/9\?cursor=p3"[^>]*>/)?.[0];
  expect(more).toBeDefined();
  // The rows are the list's, under the composer and heading the list puts on top.
  expect(html).toContain('data-key="9"');
  expect(html).toContain('data-key="7"');
});

test("the posts Load more brings are drawn on the server as rows, with their comments, from the cursor", async () => {
  backend();
  const page = await moreWall(9, "p3");
  expect(page.rows.map((row) => row.key)).toEqual(["6", "5", "4"]);
  expect(page.nextCursor).toBe("p6");
  const stream = await renderToReadableStream(
    withIntl(
      <div>
        {page.rows.map((row) => (
          <div key={row.key}>{row.node}</div>
        ))}
      </div>,
    ),
  );
  await stream.allReady;
  const html = await new Response(stream).text();
  expect(html).toContain("wall post 5");
  expect(html).toContain("comment 103");
  // The posts' links come back to the page they were drawn for.
  expect(html).not.toContain("?cursor=p6");
});
