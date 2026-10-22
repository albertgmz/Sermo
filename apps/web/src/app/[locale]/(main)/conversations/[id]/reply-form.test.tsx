import { expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QUOTE_EVENT } from "@/app/[locale]/(main)/threads/[id]/quote";
import { messages } from "@/i18n/messages";
import { withIntl } from "@/lib/test-intl";

mock.module("@/app/[locale]/(main)/conversations/actions", () => ({
  replyAction: async () => ({}),
}));
mock.module("@/app/[locale]/(main)/conversations/reply-in-place", () => ({
  replyInPlace: async () => ({}),
}));
// The editor loads Lexical when it is first used; what matters here is what it is told to listen to.
mock.module("@/components/forum/lazy-editor", () => ({
  LazyEditor: (props: { insertEvent?: string }) =>
    createElement("textarea", { "data-insert-event": props.insertEvent }),
}));
const { ReplyForm } = await import("./reply-form");

const draw = (canAttach: boolean) =>
  renderToStaticMarkup(
    withIntl(
      createElement(ReplyForm, {
        conversationId: 7,
        tailKey: "conversation:7",
        placeholder: "Write a message…",
        submitLabel: "Send message",
        canAttach,
      }),
    ),
  );

test("the editor takes the quotes the messages' Reply hands it", () => {
  expect(draw(true)).toContain(`data-insert-event="${QUOTE_EVENT}"`);
});

test("under the editor, Attach files and then the submit with a reply icon, as the thread's quick reply", () => {
  const html = draw(true);
  const attach = html.indexOf(messages.forum.attachmentField.attach);
  const submit = html.search(/<button[^>]*type="submit"/);
  expect(attach).toBeGreaterThan(-1);
  expect(submit).toBeGreaterThan(attach);
  expect(html.slice(submit)).toMatch(/lucide-reply[^>]*>.*<\/svg>Send message/);
});

test("without the right to attach there is no Attach files", () => {
  expect(draw(false)).not.toContain(messages.forum.attachmentField.attach);
});
