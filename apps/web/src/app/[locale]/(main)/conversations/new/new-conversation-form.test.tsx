import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { withIntl } from "@/lib/test-intl";

// The form hands on a server action.
mock.module("server-only", () => ({}));
const { NewConversationForm } = await import("./new-conversation-form");

const attach = messages.forum.attachmentField.attach;
const send = messages.conversations.newConversationForm.submit;

test("a new conversation ends in the composer's row: Attach files first, then the labelled send with XenForo's conversation icon", () => {
  const html = renderToStaticMarkup(withIntl(<NewConversationForm />));
  const submit = html.match(/<button[^>]*type="submit"[^>]*>(.*?)<\/button>/);
  expect(submit?.[1]).toMatch(
    new RegExp(`lucide-messages-square.*</svg>${send}$`),
  );
  expect(submit?.[0]).toContain("ml-auto");
  const label =
    html.match(/<label class="([^"]*)">[\s\S]*?<\/label>/)?.[0] ?? "";
  expect(label).toContain(`</svg>${attach}<input`);
  expect(label).toContain("order-last");
  expect(html.indexOf(attach)).toBeLessThan(html.indexOf('type="submit"'));
});

test("without the right to attach the send is alone", () => {
  const html = renderToStaticMarkup(
    withIntl(<NewConversationForm canAttach={false} />),
  );
  expect(html).not.toContain(attach);
  expect(html).toContain('type="submit"');
});
