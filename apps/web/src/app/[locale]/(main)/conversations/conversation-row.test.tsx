import { expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));

const { ConversationRow } = await import("./conversation-row");

const member = {
  id: 3,
  username: "ember",
  avatar: null,
  frame: null,
} as never;

const conversation = (isUnread: boolean) => ({
  id: 5,
  title: "Plans",
  participantCount: 2,
  isUnread,
  lastMessage: {
    messageId: 61,
    sentAt: "2026-01-01T00:00:00.000Z",
    user: { id: 3 },
  },
});

async function html(isUnread: boolean) {
  const stream = await renderToReadableStream(
    withIntl(
      <ConversationRow conversation={conversation(isUnread)} member={member} />,
    ),
  );
  await stream.allReady;
  return new Response(stream).text();
}

const links = (markup: string) =>
  [...markup.matchAll(/<a[^>]*href="([^"]*)"/g)].map((match) => match[1]);

test("a row is one target: the first unread message while there is one, else the newest, as the backend places them", async () => {
  expect(links(await html(true))).toEqual(["/conversations/5/unread"]);
  expect(links(await html(false))).toEqual(["/conversations/5/unread"]);
});

test("the avatar and the name inside a row open no member card", async () => {
  const markup = await html(false);
  expect(markup).toContain("ember");
  expect(markup).not.toContain("/members/");
  expect(markup).not.toContain("aria-haspopup");
});
