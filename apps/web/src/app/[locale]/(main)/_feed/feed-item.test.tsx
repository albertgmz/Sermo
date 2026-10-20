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
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  // The reaction button holds the router (for the sign-in path); drawn here, nothing navigates.
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
const intl = { ...(await import("next-intl")) };
const { useTranslations, useFormatter } = await import("use-intl");
mock.module("next-intl", () => ({
  ...intl,
  useLocale: () => "en",
  useTranslations,
  useFormatter,
}));
afterAll(() => {
  mock.module("next-intl/server", () => intlServer);
  mock.module("next/navigation", () => navigation);
  mock.module("next-intl", () => intl);
});
const { FeedItem } = await import("./feed-item");
const { threadHref } = await import("@/app/[locale]/(main)/threads/[id]/pages");

type Item = Parameters<typeof FeedItem>[0]["item"];

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
  attachmentCount: 0,
  attachments: [],
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

const threadItem = (
  type: "thread" | "post",
  canReply: boolean,
  featured: "staff" | "paid" | null = null,
  over: {
    unread?: unknown;
    thread?: Record<string, unknown>;
    position?: number;
  } = {},
) =>
  ({
    type,
    createdAt: "2026-01-01T00:00:00.000Z",
    following: false,
    canReply,
    featured,
    unread: over.unread ?? null,
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
      pollKind: null,
      ...over.thread,
    },
    post: postBody({
      id: type === "thread" ? 30 : 31,
      bodyHtml: "<p>the post shown</p>",
      ...(over.position === undefined ? {} : { position: over.position }),
    }),
  }) as unknown as Item;

// The avatars and the bodies are async components: the markup is read once all of it settled.
async function html(node: ReactNode) {
  const stream = await renderToReadableStream(node);
  await stream.allReady;
  return new Response(stream).text();
}

async function render(
  item: Item,
  viewerId: number | null,
  view: "cards" | "compact" = "cards",
) {
  return html(
    withIntl(
      <FeedItem
        item={item}
        author={author}
        now={Date.parse("2026-01-03T00:00:00.000Z")}
        viewerId={viewerId}
        picker={[]}
        reactionTypes={[]}
        view={view}
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

test("a wall post with more comments than the card holds has a button that loads them in place", async () => {
  const html = await render(wallItem({ commentCount: 6 }), MEMBER);
  expect(html).toMatch(/<button type="button"[^>]*>Show more comments</);
  expect(html).not.toContain("comments=");
});

test("a wall post the viewer may not comment on has no composer; the count leads to the wall, for a guest too", async () => {
  const member = await render(wallItem({ canComment: false }), MEMBER);
  expect(member).toContain("first comment");
  expect(member).not.toContain("Write a comment…");
  expect(member).not.toContain('-comment"');
  expect(countHref(member, "2 comments")).toContain(
    'href="/members/5?post=9#profile-post-9"',
  );
  const guest = await render(wallItem({ canComment: false }), null);
  expect(guest).not.toContain("Write a comment…");
  expect(countHref(guest, "2 comments")).toContain(
    'href="/members/5?post=9#profile-post-9"',
  );
});

test("a wall post with no comments and no right to comment draws nothing under its actions", async () => {
  const html = await render(
    wallItem({ canComment: false, commentCount: 0, latestComments: [] }),
    MEMBER,
  );
  expect(html).not.toContain("border-l pl-3");
});

test("a thread card has a Reply button when the viewer may reply, and nothing of the box before it is pressed", async () => {
  for (const type of ["thread", "post"] as const) {
    const html = await render(threadItem(type, true), MEMBER);
    const postId = type === "thread" ? 30 : 31;
    expect(html).toContain("the post shown");
    expect(html).toMatch(
      /<button[^>]*aria-label="Reply"[^>]*aria-expanded="false"/,
    );
    // The box is not drawn, so its code is not loaded either.
    expect(html).not.toContain("Write a reply…");
    expect(html).not.toContain(`id="feed-post-${postId}-comment"`);
    // The count of replies leads to the thread: the replies are read there.
    expect(countHref(html, "4 replies")).toContain(
      type === "thread"
        ? 'href="/threads/7"'
        : 'href="/threads/7?page=2#post-31"',
    );
  }
});

test("a featured thread is marked Featured, a promoted one Promoted, and others not at all", async () => {
  const staff = await render(threadItem("thread", true, "staff"), MEMBER);
  expect(staff).toContain("Featured");
  expect(staff).not.toContain("Promoted");
  const paid = await render(threadItem("thread", true, "paid"), MEMBER);
  expect(paid).toContain("Promoted");
  expect(paid).not.toContain("Featured");
  const plain = await render(threadItem("thread", true), MEMBER);
  expect(plain).not.toContain("Featured");
  expect(plain).not.toContain("Promoted");
});

test("a thread card without the right to reply has no Reply button; the count leads to the thread, for a guest too", async () => {
  const member = await render(threadItem("post", false), MEMBER);
  expect(member).not.toContain('aria-label="Reply"');
  expect(member).not.toContain('-comment"');
  expect(countHref(member, "4 replies")).toContain(
    'href="/threads/7?page=2#post-31"',
  );
  const guest = await render(threadItem("thread", false), null);
  expect(guest).not.toContain('aria-label="Reply"');
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

test("a signed-in member can hide the forum of a thread card from their feed; a guest and a wall post have no such button", async () => {
  const label = /aria-label="Hide [^"]* from my feed"/;
  for (const type of ["thread", "post"] as const)
    expect(await render(threadItem(type, true), MEMBER)).toMatch(label);
  expect(await render(threadItem("thread", true), null)).not.toMatch(label);
  expect(await render(wallItem(), MEMBER)).not.toMatch(label);
});

const UNREAD = { count: 3, more: false, firstPostId: 99, firstPosition: 25 };

test("a thread with unread posts shows how many and links to the first one, on its page", async () => {
  const html = await render(
    threadItem("post", true, null, { unread: UNREAD }),
    MEMBER,
  );
  const link = html.match(
    /<a[^>]*aria-label="Jump to the first of 3 unread posts"[^>]*>/,
  )?.[0];
  expect(link).toContain(`href="${threadHref(7, 25, 99)}"`);
  expect(threadHref(7, 25, 99)).toContain("#post-99");
  expect(html).toContain("3 new");
});

test("one unread post says so, and a count past the cap reads 99+", async () => {
  const one = await render(
    threadItem("thread", true, null, { unread: { ...UNREAD, count: 1 } }),
    MEMBER,
  );
  expect(one).toContain('aria-label="Jump to the unread post"');
  const many = await render(
    threadItem("thread", true, null, {
      unread: { ...UNREAD, count: 99, more: true },
    }),
    MEMBER,
  );
  expect(many).toContain("99+ new");
  expect(many).toContain("Jump to the first of 99+ unread posts");
});

test("a thread with nothing unread, a guest and a wall post have no unread link", async () => {
  expect(await render(threadItem("thread", true), MEMBER)).not.toContain(
    "Jump to",
  );
  expect(await render(threadItem("thread", false), null)).not.toContain(
    "Jump to",
  );
  expect(await render(wallItem(), MEMBER)).not.toContain("Jump to");
});

test("a thread with a poll or a quiz carries the badge; the others do not", async () => {
  const poll = await render(
    threadItem("thread", true, null, { thread: { pollKind: "poll" } }),
    MEMBER,
  );
  expect(poll).toContain("Poll");
  const quiz = await render(
    threadItem("post", true, null, { thread: { pollKind: "quiz" } }),
    MEMBER,
  );
  expect(quiz).toContain("Quiz");
  const plain = await render(threadItem("thread", true), MEMBER);
  expect(plain).not.toMatch(/>Poll<|>Quiz</);
});

test("the compact row is the thread in one line: title, where, answers and what is new; no text, no reactions, no box", async () => {
  const html = await render(
    threadItem("post", true, "staff", {
      unread: UNREAD,
      thread: { pollKind: "poll" },
    }),
    MEMBER,
    "compact",
  );
  expect(html).toContain("A thread");
  expect(html).toContain("replied to a thread in");
  expect(html).toContain("Featured");
  expect(html).toContain("Poll");
  expect(html).toContain("3 new");
  expect(countHref(html, "4 replies")).toContain(
    'href="/threads/7?page=2#post-31"',
  );
  expect(html).not.toContain("the post shown");
  expect(html).not.toContain("how it started");
  expect(html).not.toContain('aria-label="Reply"');
  expect(html).not.toContain("Hide ");
  expect(html).toContain('id="feed-post-31"');
  expect(html).toContain("data-shortcut-item");
});

// The stretched link of a row: the one anchor that covers it.
const stretched = (html: string) =>
  html.match(/<a[^>]*class="absolute inset-0"[^>]*>/)?.[0] ?? "";

test("a reply further into its thread is linked on the page that holds it, as a card and as a row", async () => {
  const item = threadItem("post", true, null, { position: 45 });
  const href = `href="${threadHref(7, 45, 31)}"`;
  expect(threadHref(7, 45, 31)).toContain("?page=");
  expect(countHref(await render(item, MEMBER), "4 replies")).toContain(href);
  expect(stretched(await render(item, MEMBER, "compact"))).toContain(href);
});

test("the whole compact row is a link, under its own links and buttons", async () => {
  const thread = await render(threadItem("post", true), MEMBER, "compact");
  expect(stretched(thread)).toContain('href="/threads/7?page=2#post-31"');
  expect(stretched(thread)).toContain('tabindex="-1"');
  const wall = await render(wallItem(), MEMBER, "compact");
  expect(stretched(wall)).toContain('href="/members/5?post=9#profile-post-9"');
  // The title's link, the forum's and the actions sit above it.
  expect(thread).toContain("relative z-10");
});

test("a compact wall post names who wrote it and where, with its comments", async () => {
  const html = await render(wallItem(), MEMBER, "compact");
  expect(html).toContain("member4");
  expect(html).toContain("posted on");
  expect(html).not.toContain("the wall post");
  expect(html).not.toContain("first comment");
  expect(countHref(html, "2 comments")).toContain(
    'href="/members/5?post=9#profile-post-9"',
  );
});

test("a compact row for a new thread leads its count to the thread", async () => {
  const html = await render(threadItem("thread", false), null, "compact");
  expect(countHref(html, "4 replies")).toContain('href="/threads/7"');
  expect(html).not.toContain("Jump to");
});
