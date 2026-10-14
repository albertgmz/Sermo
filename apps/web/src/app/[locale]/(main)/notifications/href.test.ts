import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import {
  postBody,
  profileCommentBody,
  profilePostBody,
} from "@/lib/test-bodies";

const realFetch = globalThis.fetch;

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));

const { hrefOf } = await import("./href");

const STAMP = "2026-01-01T00:00:00.000Z";
const ember = { id: 3, username: "ember" };

// What a notification lists; a case overrides what it is about.
function notice(over: Record<string, unknown>) {
  return {
    id: 1,
    type: "content.mentioned",
    contentType: "post",
    contentId: 31,
    threadId: 7,
    actors: [ember],
    actorCount: 1,
    contentTitle: null,
    url: "/notifications",
    data: {},
    createdAt: STAMP,
    updatedAt: STAMP,
    read: false,
    ...over,
  } as Parameters<typeof hrefOf>[0];
}

let refused = false;
const asked: string[] = [];
beforeEach(() => {
  refused = false;
  asked.length = 0;
  globalThis.fetch = (async (url: string) => {
    const { pathname } = new URL(url);
    asked.push(pathname);
    if (refused) {
      return Response.json(
        { error: { code: "not_found", message: "?" } },
        { status: 404 },
      );
    }
    if (pathname === "/api/v1/posts/31") {
      return Response.json(postBody({ id: 31, threadId: 7, position: 25 }));
    }
    if (pathname === "/api/v1/profile-posts/12") {
      return Response.json(profilePostBody());
    }
    if (pathname === "/api/v1/profile-comments/44") {
      return Response.json(profileCommentBody());
    }
    return Response.json(
      { error: { code: "not_found", message: "?" } },
      { status: 404 },
    );
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

// POSTS_PER_PAGE is 20 in these cases: position 25 is on page 2.
const cases: [string, Record<string, unknown>, string][] = [
  [
    "a reply in a watched thread: its page and post",
    { type: "thread.watched" },
    "/threads/7?page=2#post-31",
  ],
  ["a quote", { type: "content.quoted" }, "/threads/7?page=2#post-31"],
  [
    "a reaction to a post",
    { type: "content.reaction" },
    "/threads/7?page=2#post-31",
  ],
  [
    "a new thread of a forum or a member",
    { type: "node.thread", contentType: "thread", contentId: 7 },
    "/threads/7",
  ],
  [
    "a wall post",
    {
      type: "profile.post",
      contentType: "profile_post",
      contentId: 12,
      threadId: null,
    },
    "/members/9?post=12#profile-post-12",
  ],
  [
    "a reaction to a wall post",
    {
      type: "content.reaction",
      contentType: "profile_post",
      contentId: 12,
      threadId: null,
    },
    "/members/9?post=12#profile-post-12",
  ],
  [
    "a comment on a wall post",
    {
      type: "profile.comment",
      contentType: "profile_post_comment",
      contentId: 44,
      threadId: null,
    },
    "/members/9?post=12&comment=44#profile-comment-44",
  ],
  [
    "a comment after yours",
    {
      type: "profile.commented",
      contentType: "profile_post_comment",
      contentId: 44,
      threadId: null,
    },
    "/members/9?post=12&comment=44#profile-comment-44",
  ],
  [
    "being added to a conversation",
    {
      type: "conversation.added",
      contentType: "conversation",
      contentId: 5,
      threadId: null,
    },
    "/conversations/5",
  ],
  [
    "a mention inside a conversation message",
    {
      type: "content.mentioned",
      contentType: "conversation_message",
      contentId: 61,
      threadId: null,
      data: { conversationId: 5 },
    },
    "/conversations/5?message=61#message-61",
  ],
  [
    "a reaction to a conversation message",
    {
      type: "content.reaction",
      contentType: "conversation_message",
      contentId: 61,
      threadId: null,
      data: { conversationId: 5 },
    },
    "/conversations/5?message=61#message-61",
  ],
  [
    "a message whose conversation the alert does not name",
    {
      type: "content.mentioned",
      contentType: "conversation_message",
      contentId: 61,
      threadId: null,
    },
    "/conversations",
  ],
  [
    "a new follower: the follower's profile",
    {
      type: "member.followed",
      contentType: "user",
      contentId: 1,
      threadId: null,
    },
    "/members/3",
  ],
  [
    "a warning or a change of groups: the member's own profile",
    {
      type: "moderation.member",
      contentType: "user",
      contentId: 1,
      threadId: null,
      url: "/users/1",
    },
    "/members/1",
  ],
  [
    "a moderator's action on a post",
    { type: "moderation.content" },
    "/threads/7?page=2#post-31",
  ],
  [
    "a new report: its screen in the moderation panel",
    {
      type: "moderator.report",
      contentType: "report_group",
      contentId: 8,
      threadId: null,
      url: "/reports/8",
    },
    "/moderation/reports/8",
  ],
  [
    "content waiting for approval: the approval screen",
    {
      type: "moderator.approval",
      contentType: "profile_post",
      contentId: 12,
      threadId: null,
    },
    "/moderation/approvals/profile_post/12",
  ],
  [
    "the outcome of a report you made: a reporter has no page for it",
    {
      type: "report.resolved",
      contentType: "report_group",
      contentId: 8,
      threadId: null,
      url: "/reports/8",
    },
    "/notifications",
  ],
  [
    "an announcement: no member page shows one",
    {
      type: "announcement",
      contentType: "announcement",
      contentId: 2,
      threadId: null,
      url: "/announcements/2",
    },
    "/notifications",
  ],
  [
    "an announcement with a site link: that page",
    {
      type: "announcement",
      contentType: "announcement",
      contentId: 2,
      threadId: null,
      url: "/pages/rules",
    },
    "/pages/rules",
  ],
  [
    "an announcement with an outside link: that address",
    {
      type: "announcement",
      contentType: "announcement",
      contentId: 2,
      threadId: null,
      url: "https://example.org/news",
    },
    "https://example.org/news",
  ],
  [
    "an announcement link kept as given, even when it looks like a backend path",
    {
      type: "announcement",
      contentType: "announcement",
      contentId: 2,
      threadId: null,
      url: "/reports/8",
    },
    "/reports/8",
  ],
  [
    "a kind this site does not know",
    {
      type: "something.new",
      contentType: "widget",
      contentId: 2,
      threadId: null,
      url: "/widgets/2",
    },
    "/widgets/2",
  ],
];

for (const [name, over, expected] of cases) {
  test(`${name} leads to ${expected}`, async () => {
    expect(await hrefOf(notice(over))).toBe(expected);
  });
}

test("content the viewer can no longer open falls back to the backend's own path or the list", async () => {
  refused = true;
  expect(
    await hrefOf(notice({ type: "thread.watched", url: "/threads/7#post-31" })),
  ).toBe("/threads/7#post-31");
  expect(
    await hrefOf(
      notice({
        type: "profile.post",
        contentType: "profile_post",
        contentId: 12,
        threadId: null,
        url: "/profile-posts/12",
      }),
    ),
  ).toBe("/notifications");
});

test("a follower alert with no actor listed falls back to the member's profile", async () => {
  expect(
    await hrefOf(
      notice({
        type: "member.followed",
        contentType: "user",
        contentId: 1,
        actors: [],
        url: "/users/1",
      }),
    ),
  ).toBe("/members/1");
});
