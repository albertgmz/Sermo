import { expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
// The avatar reads the visitor's LITE preference from the request.
mock.module("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
  headers: async () => new Headers(),
}));
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  useRouter: () => ({ refresh: () => {} }),
}));
mock.module("@/app/(main)/conversations/actions", () => ({
  addParticipantsAction: async () => ({}),
  renameAction: async () => ({}),
  markRead: async () => {},
  findRecipients: async () => [],
}));

const { ConversationWidgets } = await import("./conversation-widgets");

const person = (id: number, username: string) => ({ id, username });
const member = (id: number) => ({
  id,
  username: id === 1 ? "ember" : `member${id}`,
  avatar: null,
  frame: null,
  nameColor: null,
  title: "Member",
  badges: [],
  level: 1,
});
const stamp = "2026-03-04T10:00:00.000Z";
const conversation = {
  id: 7,
  title: "Plans for the weekend",
  starter: person(1, "ember"),
  createdAt: stamp,
  lastMessage: { messageId: 9, sentAt: stamp, user: person(1, "ember") },
  messageCount: 4,
  participantCount: 2,
  isUnread: false,
  participants: [
    { user: person(1, "ember"), state: "active" as const },
    { user: person(2, "member2"), state: "active" as const },
    { user: person(3, "member3"), state: "left" as const },
  ],
  canReply: true,
  canInvite: true,
  canRename: true,
};

// The avatars are async components: wait for the whole page before reading it.
async function draw(overrides: Partial<typeof conversation> = {}) {
  const stream = await renderToReadableStream(
    withIntl(
      createElement(ConversationWidgets, {
        conversation: { ...conversation, ...overrides },
        member,
      }),
    ),
  );
  await stream.allReady;
  return new Response(stream).text();
}

test("the information widget tells who started the conversation, when, and how big it is", async () => {
  const html = await draw();
  expect(html).toContain("Started by");
  expect(html).toContain("ember");
  expect(html).toContain("Mar 4, 2026");
  expect(html).toContain("Messages");
});

test("every participant is listed and one who left is marked", async () => {
  const html = await draw();
  expect(html).toContain("member2");
  expect(html).toContain("member3");
  expect(html).toContain("(left)");
});

test("the add-people action is drawn only when the viewer may invite", async () => {
  expect(await draw()).toContain("Add people");
  expect(await draw({ canInvite: false })).not.toContain("Add people");
});

test("the rename form is drawn only when the viewer may rename, with the current title", async () => {
  const html = await draw();
  expect(html).toContain('value="Plans for the weekend"');
  const without = await draw({ canRename: false });
  expect(without).not.toContain('value="Plans for the weekend"');
  expect(without).not.toContain("Conversation name");
});

test("mark as read is drawn only while the latest message is unread", async () => {
  expect(await draw()).not.toContain("Mark as read");
  expect(await draw({ isUnread: true })).toContain("Mark as read");
});
