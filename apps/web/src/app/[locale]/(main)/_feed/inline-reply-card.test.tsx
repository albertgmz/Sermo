import { afterAll, beforeEach, expect, mock, test } from "bun:test";
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
const navigation = { ...(await import("next/navigation")) };
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
const intl = { ...(await import("next-intl")) };
const { useTranslations, useFormatter } = await import("use-intl");
mock.module("next-intl", () => ({
  ...intl,
  useLocale: () => "en",
  useTranslations,
  useFormatter,
}));

// The card's reply box is a stand-in that keeps what the card gave it, and the page's own action
// records its call: what is checked is what the card wires, the action itself is tested with the
// backend in `(main)/actions.test.ts`.
const actions = { ...(await import("@/app/[locale]/(main)/actions")) };
const inlineReply = { ...(await import("@/components/forum/inline-reply")) };
type Held = {
  action?: (previous: object, form: FormData) => Promise<unknown>;
  label?: string;
  placeholder?: string;
  submitLabel?: string;
  anchor?: string;
};
const held: Held[] = [];
const calls: unknown[][] = [];
mock.module("@/app/[locale]/(main)/actions", () => ({
  ...actions,
  replyFromFeed: async (...args: unknown[]) => {
    calls.push(args);
    return {};
  },
}));
mock.module("@/components/forum/inline-reply", () => ({
  ...inlineReply,
  InlineReply: (props: Held) => {
    held.push(props);
    return <i data-mark="reply" />;
  },
}));
afterAll(() => {
  mock.module("next-intl/server", () => intlServer);
  mock.module("next/navigation", () => navigation);
  mock.module("next-intl", () => intl);
  mock.module("@/app/[locale]/(main)/actions", () => actions);
  mock.module("@/components/forum/inline-reply", () => inlineReply);
});
beforeEach(() => {
  held.length = 0;
  calls.length = 0;
});
const { FeedItem } = await import("./feed-item");

type Item = Parameters<typeof FeedItem>[0]["item"];

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

const item = (threadId: number, canReply: boolean) =>
  ({
    type: "thread",
    createdAt: "2026-01-01T00:00:00.000Z",
    following: false,
    canReply,
    featured: null,
    unread: null,
    thread: {
      id: threadId,
      nodeId: 2,
      node: { id: 2, title: "General" },
      title: "A thread",
      prefix: null,
      excerpt: "",
      cover: null,
      highlightedUntil: null,
      bumpedAt: null,
      author: { id: 4, username: "member4" },
      state: "visible",
      isSticky: false,
      isLocked: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      replyCount: 0,
      viewCount: 0,
      firstPostId: 30,
      lastPost: {
        postId: 30,
        position: 0,
        postedAt: "2026-01-01T00:00:00.000Z",
        user: { id: 4, username: "member4" },
      },
      readPosition: null,
      isUnread: false,
      pollKind: null,
    },
    post: postBody({ id: 30, bodyHtml: "<p>text</p>" }),
  }) as unknown as Item;

async function html(node: ReactNode) {
  const stream = await renderToReadableStream(node);
  await stream.allReady;
  return new Response(stream).text();
}

const draw = (threadItem: Item) =>
  html(
    withIntl(
      <FeedItem
        item={threadItem}
        author={author}
        now={Date.parse("2026-01-03T00:00:00.000Z")}
        viewerId={3}
        picker={[]}
        reactionTypes={[]}
      />,
    ),
  );

test("the box of a card replies to that card's own thread through the page's action", async () => {
  await draw(item(7, true));
  expect(held).toHaveLength(1);
  const form = new FormData();
  form.set("body", "hello");
  await held[0]?.action?.({}, form);
  expect(calls).toEqual([[7, {}, form]]);
  // Another card, another thread.
  held.length = 0;
  calls.length = 0;
  await draw(item(12, true));
  await held[0]?.action?.({}, form);
  expect(calls[0]?.[0]).toBe(12);
});

test("the card gives the box its words and an address of its own, and a viewer who may not reply gets no box", async () => {
  await draw(item(7, true));
  expect(held[0]).toMatchObject({
    label: "Reply",
    placeholder: "Write a reply…",
    submitLabel: "Post reply",
    anchor: "feed-post-30-comment",
  });
  held.length = 0;
  await draw(item(7, false));
  expect(held).toHaveLength(0);
});
