import { afterAll, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
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
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, prefetch() {} }),
}));
// Another suite replaces the translator with one that fills no placeholders: use the real one.
const intl = { ...(await import("next-intl")) };
const { useTranslations, useFormatter } = await import("use-intl");
mock.module("next-intl", () => ({
  ...intl,
  useLocale: () => "en",
  useNow: () => new Date("2026-01-03T00:00:00.000Z"),
  useTranslations,
  useFormatter,
}));
afterAll(() => {
  mock.module("next-intl/server", () => intlServer);
  mock.module("next/navigation", () => navigation);
  mock.module("next-intl", () => intl);
});
const { ThreadRow } = await import("./thread-row");

const member = (id: number) => ({
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
});

const thread = (pollKind: "poll" | "quiz" | null) =>
  ({
    id: 7,
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
    pollKind,
  }) as unknown as Parameters<typeof ThreadRow>[0]["thread"];

async function draw(node: ReactNode) {
  const stream = await renderToReadableStream(withIntl(node));
  await stream.allReady;
  return new Response(stream).text();
}

const row = (pollKind: "poll" | "quiz" | null, signedIn = false) =>
  draw(
    <ThreadRow
      thread={thread(pollKind)}
      member={member}
      highlighted={false}
      signedIn={signedIn}
    />,
  );

test("a thread with a poll or a quiz carries the badge in the forum's list", async () => {
  expect(await row("poll")).toContain("Poll");
  expect(await row("quiz")).toContain("Quiz");
  expect(await row(null)).not.toMatch(/>Poll<|>Quiz</);
});

test("a member's links to a thread open where they left off and a guest's open its start", async () => {
  const hrefs = (html: string) =>
    [...html.matchAll(/href="(\/threads\/[^"]*)"/g)].map((found) => found[1]);
  expect(new Set(hrefs(await row(null, true)))).toEqual(
    new Set(["/threads/7/unread"]),
  );
  expect(new Set(hrefs(await row(null, false)))).toEqual(
    new Set(["/threads/7"]),
  );
});
