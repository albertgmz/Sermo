import { expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

mock.module("@/app/[locale]/(main)/conversations/[id]/reply-form", () => ({
  ReplyForm: () => createElement("form", { id: "reply-form" }),
}));

const { LockedBadge, ReplyArea } = await import("./locked-state");

const stamp = "2026-03-04T10:00:00.000Z";
const conversation = {
  id: 7,
  title: "Plans",
  starter: { id: 1, username: "ember" },
  createdAt: stamp,
  lastMessage: {
    messageId: 9,
    sentAt: stamp,
    user: { id: 1, username: "ember" },
  },
  messageCount: 4,
  participantCount: 2,
  isUnread: false,
  participants: [],
  canReply: true,
  canInvite: false,
  canRename: false,
  isLocked: false,
  canLock: false,
};
const NOTE = "This conversation is locked: no new replies.";
const draw = (over: Partial<typeof conversation>) =>
  renderToStaticMarkup(
    withIntl(
      createElement(ReplyArea, { conversation: { ...conversation, ...over } }),
    ),
  );

test("the badge says the conversation is locked", () => {
  expect(renderToStaticMarkup(withIntl(createElement(LockedBadge)))).toContain(
    "Locked",
  );
});

test("an open conversation shows the form alone", () => {
  const html = draw({});
  expect(html).toContain("reply-form");
  expect(html).not.toContain(NOTE);
});

test("a moderator of a locked conversation sees the note above the form", () => {
  const html = draw({ isLocked: true });
  expect(html).toContain(NOTE);
  expect(html).toContain("reply-form");
  expect(html.indexOf(NOTE)).toBeLessThan(html.indexOf("reply-form"));
});

test("anyone else sees the note instead of the form", () => {
  const html = draw({ isLocked: true, canReply: false });
  expect(html).toContain(NOTE);
  expect(html).not.toContain("reply-form");
});

test("a member who may not reply to an open conversation gets the plain refusal", () => {
  const html = draw({ canReply: false });
  expect(html).toContain("You cannot reply to this conversation.");
  expect(html).not.toContain(NOTE);
});
