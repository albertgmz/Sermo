import { expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import { byMemberId } from "@/lib/test-members";

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
mock.module("@/app/[locale]/(main)/conversations/actions", () => ({
  addParticipantsAction: async () => ({}),
  markRead: async () => true,
  markReadAction: async () => ({}),
  findRecipients: async () => [],
}));

const { ConversationWidgets } = await import("./conversation-widgets");
const { MarkReadContext } = await import("./mark-read-state");

const person = (id: number, username: string) => ({ id, username });
const member = byMemberId((id: number) => ({
  id,
  username: id === 1 ? "ember" : `member${id}`,
  avatar: null,
  frame: null,
  nameColor: null,
  nameIcon: null,
  restricted: false,
  title: "Member",
  badges: [],
  level: 1,
}));
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
  isLocked: false,
  canLock: true,
};

// The avatars are async components: wait for the whole page before reading it.
async function draw(
  overrides: Partial<typeof conversation> = {},
  autoMarkFailed = false,
) {
  const stream = await renderToReadableStream(
    withIntl(
      createElement(
        MarkReadContext,
        { value: { failed: autoMarkFailed, setFailed: () => {} } },
        createElement(ConversationWidgets, {
          conversation: { ...conversation, ...overrides },
          member,
        }),
      ),
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

test("the starter's name in the information widget is shown whole, never cut by an ellipsis", async () => {
  const html = await draw();
  const value = html.slice(html.indexOf("Started by"));
  const cell = /<dd class="([^"]*)">/.exec(value)?.[1] ?? "";
  expect(cell).not.toBe("");
  expect(cell).not.toContain("truncate");
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

// Renaming and locking are in the header's Edit dialog, as XenForo's, not in cards of their own.
test("the widgets hold no rename or lock card, whatever the viewer may change", async () => {
  for (const html of [await draw(), await draw({ isLocked: true })]) {
    expect(html).not.toContain('value="Plans for the weekend"');
    expect(html).not.toContain("Rename");
    expect(html).not.toContain("Lock direct message");
    expect(html).not.toContain("Unlock direct message");
  }
});

test("mark as read is not drawn while the page's own mark is running or when nothing is unread", async () => {
  expect(await draw()).not.toContain("Mark as read");
  expect(await draw({ isUnread: true })).not.toContain("Mark as read");
  expect(await draw({ isUnread: false }, true)).not.toContain("Mark as read");
});

test("mark as read is drawn for an unread conversation once the page's own mark has failed", async () => {
  expect(await draw({ isUnread: true }, true)).toContain("Mark as read");
});
