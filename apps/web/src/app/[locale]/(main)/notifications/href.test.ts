import { afterEach, beforeEach, expect, mock, test } from "bun:test";

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

const asked: string[] = [];
beforeEach(() => {
  asked.length = 0;
  globalThis.fetch = (async (url: string) => {
    asked.push(new URL(url).pathname);
    return Response.json(
      { error: { code: "not_found", message: "?" } },
      { status: 404 },
    );
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const cases: [string, Record<string, unknown>, string][] = [
  [
    "a reply in a watched thread: the post",
    { type: "thread.watched" },
    "/posts/31",
  ],
  ["a quote", { type: "content.quoted" }, "/posts/31"],
  ["a reaction to a post", { type: "content.reaction" }, "/posts/31"],
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
    "/profile-posts/12",
  ],
  [
    "a reaction to a wall post",
    {
      type: "content.reaction",
      contentType: "profile_post",
      contentId: 12,
      threadId: null,
    },
    "/profile-posts/12",
  ],
  [
    "a comment on a wall post",
    {
      type: "profile.comment",
      contentType: "profile_post_comment",
      contentId: 44,
      threadId: null,
    },
    "/profile-comments/44",
  ],
  [
    "a comment after yours",
    {
      type: "profile.commented",
      contentType: "profile_post_comment",
      contentId: 44,
      threadId: null,
    },
    "/profile-comments/44",
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
    "/conversations/messages/61",
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
    "/conversations/messages/61",
  ],
  [
    "a message whose conversation the alert does not name",
    {
      type: "content.mentioned",
      contentType: "conversation_message",
      contentId: 61,
      threadId: null,
    },
    "/conversations/messages/61",
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
    "/posts/31",
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
    "a new account waiting for approval: the sign-up queue",
    {
      type: "moderator.signup",
      contentType: "user",
      contentId: 41,
      threadId: null,
    },
    "/moderation/signups",
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

test("content is linked by its own address: the list asks the backend nothing per row", async () => {
  for (const [, over] of cases) await hrefOf(notice(over));
  expect(asked).toEqual([]);
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
