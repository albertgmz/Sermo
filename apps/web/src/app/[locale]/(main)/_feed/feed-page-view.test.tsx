import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { postBody, profilePostBody } from "@/lib/test-bodies";
import { translator, withIntl } from "@/lib/test-intl";
import { withQuery } from "@/lib/test-query";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;

let cookie: string | undefined;
mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: () => (cookie === undefined ? undefined : { value: cookie }),
    toString: () => "",
  }),
}));
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    push() {},
    replace() {},
    refresh() {},
    back() {},
    forward() {},
    prefetch() {},
  }),
}));
// Another suite replaces the translator with one that fills no placeholders: use the real one.
const intlClient = { ...(await import("next-intl")) };
const { useTranslations, useFormatter } = await import("use-intl");
mock.module("next-intl", () => ({
  ...intlClient,
  useLocale: () => "en",
  useTranslations,
  useFormatter,
}));
const { viewerOfRequest } = await import("@/lib/sermo/client");
const { feedPage } = await import("./feed-page");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next/navigation", () => navigation);
  mock.module("next-intl", () => intlClient);
});
beforeEach(() => {
  mock.module("@/lib/sermo/session", () => ({ getViewer: viewerOfRequest }));
});
afterEach(() => {
  globalThis.fetch = realFetch;
  cookie = undefined;
});

const thread = {
  id: 7,
  nodeId: 2,
  node: { id: 2, title: "General" },
  title: "A thread",
  prefix: null,
  excerpt: "how it started",
  cover: null,
  highlightedUntil: null,
  bumpedAt: null,
  author: { id: 4, username: "member4" },
  state: "visible",
  isSticky: false,
  isLocked: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  replyCount: 4,
  viewCount: 10,
  firstPostId: 30,
  lastPost: {
    postId: 30,
    position: 0,
    postedAt: "2026-01-01T00:00:00.000Z",
    user: { id: 4, username: "member4" },
  },
  readPosition: null,
  isUnread: true,
  pollKind: "poll",
};
const entry = {
  type: "thread",
  createdAt: "2026-01-01T00:00:00.000Z",
  following: false,
  canReply: true,
  featured: null,
  unread: { count: 5, more: false, firstPostId: 30, firstPosition: 0 },
  thread,
  post: postBody({ id: 30, bodyHtml: "<p>the opening text</p>" }),
};

const wallEntry = {
  type: "profilePost",
  createdAt: "2026-01-01T00:00:00.000Z",
  following: false,
  featured: null,
  profilePost: profilePostBody({
    author: { id: 4, username: "member4" },
    canComment: true,
  }),
};

// The viewer, one thread entry (or `item`), and empty answers for everything else.
function backend(member: { feedView: string } | null, item: object = entry) {
  globalThis.fetch = (async (url: string) => {
    const { pathname } = new URL(url);
    if (pathname === "/api/v1/me") {
      const body = viewerBody(member !== null);
      if (body.user && member) Object.assign(body.user, member);
      return Response.json(body);
    }
    if (pathname === "/api/v1/feed")
      return Response.json({ items: [item], nextCursor: null });
    return Response.json({ items: [], nextCursor: null });
  }) as unknown as typeof fetch;
}

async function drawn(node: ReactNode) {
  const stream = await renderToReadableStream(withIntl(withQuery(node)));
  await stream.allReady;
  return new Response(stream).text();
}

async function firstRow() {
  const page = await feedPage("latest");
  expect(page.rows).toHaveLength(1);
  return drawn(page.rows[0]?.node);
}

test("a member who chose the compact list is drawn rows: no text of the post, the counts and the unread link", async () => {
  backend({ feedView: "compact" });
  const html = await firstRow();
  expect(html).toContain("A thread");
  expect(html).toContain("5 new");
  expect(html).toContain("Poll");
  expect(html).not.toContain("the opening text");
  expect(html).not.toContain('aria-label="Reply"');
});

test("a member on cards is drawn the card, with its text, its Reply button and the unread link", async () => {
  backend({ feedView: "cards" });
  const html = await firstRow();
  expect(html).toContain("the opening text");
  expect(html).toContain('aria-label="Reply"');
  expect(html).toContain("5 new");
  expect(html).toContain("Poll");
});

test("a guest's cookie decides, and a guest has cards without one", async () => {
  backend(null);
  expect(await firstRow()).toContain("the opening text");
  cookie = "compact";
  expect(await firstRow()).not.toContain("the opening text");
});

test("the composer under a wall post carries the viewer's avatar, so the viewer is looked up too", async () => {
  backend({ feedView: "cards" }, wallEntry);
  const html = await firstRow();
  const composer = html.slice(
    html.indexOf('id="feed-profile-post-12-comment"'),
  );
  expect(composer).toContain('href="/members/1"');
});
