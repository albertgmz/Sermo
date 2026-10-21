import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("@/app/[locale]/(main)/conversations/actions", () => ({
  markUnreadAction: async () => ({}),
}));
const { MarkUnreadForm } = await import("./mark-unread-form");

test("the button is a form named after its label, with the text kept for screen readers on phones", () => {
  const html = renderToStaticMarkup(
    <MarkUnreadForm conversationId={4} label="Mark as unread">
      <svg />
    </MarkUnreadForm>,
  );
  expect(html).toContain("<form");
  expect(html).toContain('aria-label="Mark as unread"');
  expect(html).toContain('<span class="max-sm:sr-only">Mark as unread</span>');
});
