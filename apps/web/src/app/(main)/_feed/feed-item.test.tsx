import { afterAll, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import type { AuthorView } from "@/lib/sermo/views";
import { postBody } from "@/lib/test-bodies";
import { translator, withIntl } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const intlServer = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getTranslations: async (namespace: string) => translator(namespace),
}));
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
// Another suite replaces the translator with one that fills no placeholders: use the real one.
const intl = { ...(await import("next-intl")) };
const { useTranslations, useFormatter } = await import("use-intl");
mock.module("next-intl", () => ({ ...intl, useTranslations, useFormatter }));
afterAll(() => {
  mock.module("next-intl/server", () => intlServer);
  mock.module("next/navigation", () => navigation);
  mock.module("next-intl", () => intl);
});
const { FeedItem } = await import("./feed-item");

type Item = Parameters<typeof FeedItem>[0]["item"];

const FEED = "/?tab=top&cursor=abc";
const MEMBER = 3;

const author = (id: number): AuthorView => ({
  member: {
    id,
    username: `member${id}`,
    avatar: null,
    frame: null,
    nameColor: null,
    nameIcon: null,
    title: "",
    badges: [],
    level: 1,
    restricted: false,
  },
  cover: null,
  joinedAt: "2026-01-01T00:00:00.000Z",
  postCount: 0,
  reactionScore: 0,
  xp: 0,
  currentLevelXp: 0,
  nextLevelXp: 100,
  awards: [],
  signatureHtml: null,
});

const comment = (id: number, bodyHtml: string) => ({
  id,
  profilePostId: 9,
  author: { id: 20 + id, username: `member${20 + id}` },
  state: "visible",
  createdAt: "2026-01-02T00:00:00.000Z",
  editedAt: null,
  bodyHtml,
  reactions: { counts: {}, total: 0, mine: null },
  canEdit: false,
  canDelete: false,
});

const wallItem = (over: Record<string, unknown> = {}) =>
  ({
    type: "profilePost",
    createdAt: "2026-01-01T00:00:00.000Z",
    following: false,
    profilePost: {
      id: 9,
      profileUserId: 5,
      author: { id: 4, username: "member4" },
      state: "visible",
      createdAt: "2026-01-01T00:00:00.000Z",
      editedAt: null,
      bodyHtml: "<p>the wall post</p>",
      attachmentCount: 0,
      attachments: [],
      reactions: { counts: {}, total: 0, mine: null },
      commentCount: 2,
      latestComments: [
        comment(1, "<p>first comment</p>"),
        comment(2, "<p>second comment</p>"),
      ],
      canEdit: false,
      canDelete: false,
      canComment: true,
      ...over,
    },
  }) as unknown as Item;

const threadItem = (type: "thread" | "post", canReply: boolean) =>
  ({
    type,
    createdAt: "2026-01-01T00:00:00.000Z",
    following: false,
    canReply,
    thread: {
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
        postId: 31,
        position: 4,
        postedAt: "2026-01-01T00:00:00.000Z",
        user: { id: 3, username: "member3" },
      },
      readPosition: null,
      isUnread: false,
    },
    post: postBody({
      id: type === "thread" ? 30 : 31,
      bodyHtml: "<p>the post shown</p>",
    }),
  }) as unknown as Item;

// The avatars and the bodies are async components: the markup is read once all of it settled.
async function html(node: ReactNode) {
  const stream = await renderToReadableStream(node);
  await stream.allReady;
  return new Response(stream).text();
}

async function render(item: Item, viewerId: number | null) {
  return html(
    withIntl(
      <FeedItem
        item={item}
        author={author}
        now={Date.parse("2026-01-03T00:00:00.000Z")}
        viewerId={viewerId}
        picker={[]}
        reactionTypes={[]}
        returnTo={FEED}
      />,
    ),
  );
}

// The address the count of answers leads to.
const countHref = (html: string, label: string) =>
  html.match(new RegExp(`<a[^>]*aria-label="${label}"[^>]*>`))?.[0];

test("a wall post is drawn with its latest comments and a composer for the next one", async () => {
  const html = await render(wallItem(), MEMBER);
  expect(html).toContain("the wall post");
  expect(html.indexOf("first comment")).toBeGreaterThan(-1);
  expect(html.indexOf("second comment")).toBeGreaterThan(
    html.indexOf("first comment"),
  );
  expect(html).toContain("member21");
  expect(html).toContain('id="feed-profile-post-9-comment"');
  expect(html).toContain("Write a comment…");
  expect(html).toContain('aria-label="Post comment"');
  expect(countHref(html, "2 comments")).toContain(
    'href="#feed-profile-post-9-comment"',
  );
  expect(html).not.toContain("Show more comments");
});

test("a wall post with more comments than the card holds links to all of them on the wall", async () => {
  const html = await render(wallItem({ commentCount: 6 }), MEMBER);
  expect(html).toMatch(
    /<a[^>]*href="\/members\/5\?comments=9#profile-post-9"[^>]*>Show more comments</,
  );
});

test("a wall post the viewer may not comment on has no composer; the count leads to the wall, for a guest too", async () => {
  const member = await render(wallItem({ canComment: false }), MEMBER);
  expect(member).toContain("first comment");
  expect(member).not.toContain("Write a comment…");
  expect(member).not.toContain('-comment"');
  expect(countHref(member, "2 comments")).toContain(
    'href="/members/5#profile-post-9"',
  );
  const guest = await render(wallItem({ canComment: false }), null);
  expect(guest).not.toContain("Write a comment…");
  expect(countHref(guest, "2 comments")).toContain(
    'href="/members/5#profile-post-9"',
  );
});

test("a wall post with no comments and no right to comment draws nothing under its actions", async () => {
  const html = await render(
    wallItem({ canComment: false, commentCount: 0, latestComments: [] }),
    MEMBER,
  );
  expect(html).not.toContain("border-l pl-3");
});

test("a thread card has a reply box when the viewer may reply, for a new thread and for a reply", async () => {
  for (const type of ["thread", "post"] as const) {
    const html = await render(threadItem(type, true), MEMBER);
    const postId = type === "thread" ? 30 : 31;
    expect(html).toContain("the post shown");
    expect(html).toContain(`id="feed-post-${postId}-comment"`);
    expect(html).toContain("Write a reply…");
    expect(html).toContain('aria-label="Post reply"');
    expect(countHref(html, "4 replies")).toContain(
      `href="#feed-post-${postId}-comment"`,
    );
  }
});

test("a thread card without the right to reply has no reply box; the count leads to the thread, for a guest too", async () => {
  const member = await render(threadItem("post", false), MEMBER);
  expect(member).not.toContain("Write a reply…");
  expect(member).not.toContain('-comment"');
  expect(countHref(member, "4 replies")).toContain('href="/threads/7#post-31"');
  const guest = await render(threadItem("thread", false), null);
  expect(guest).not.toContain("Write a reply…");
  expect(countHref(guest, "4 replies")).toContain('href="/threads/7"');
});

test("a reply entry reads as its thread: the title, how it started, then the newest reply", async () => {
  const html = await render(threadItem("post", false), MEMBER);
  const title = html.indexOf("A thread");
  const opener = html.indexOf("how it started");
  const reply = html.indexOf("the post shown");
  expect(title).toBeGreaterThan(-1);
  expect(opener).toBeGreaterThan(title);
  expect(reply).toBeGreaterThan(opener);
  expect(html).toContain("replied to a thread in");
});
