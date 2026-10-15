import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { withIntl } from "@/lib/test-intl";
import { Editor } from "./editor";

const text = messages.editor.editor;

test("the bar has the spoiler, code block and media buttons beside the others", () => {
  const html = renderToStaticMarkup(withIntl(<Editor name="body" />));
  for (const label of [
    text.boldLabel,
    text.italicLabel,
    text.removeFormattingLabel,
    text.linkLabel,
    text.quoteLabel,
    text.bulletListLabel,
    text.spoilerLabel,
    text.codeBlockLabel,
    text.mediaLabel,
  ]) {
    expect(html).toContain(`aria-label="${label}"`);
  }
  // Its own scroll box, so a narrow screen scrolls the bar and not the page.
  expect(html).toMatch(
    /role="toolbar"[^>]*class="[^"]*relative[^"]*overflow-x-auto/,
  );
});
