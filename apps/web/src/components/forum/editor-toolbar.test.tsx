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

test("the bar has an underline button and the button that shows the BB code source", () => {
  const html = renderToStaticMarkup(withIntl(<Editor name="body" />));
  expect(html).toContain(`aria-label="${text.underlineLabel}"`);
  expect(html).toContain(`aria-label="${text.sourceLabel}"`);
  // The source is not shown until it is asked for, and the rich text is.
  expect(html).not.toContain("<textarea");
  expect(html).toContain('role="textbox"');
});

test("an editor with no bar has no way to the source, and still sends BB code", () => {
  const html = renderToStaticMarkup(
    withIntl(<Editor compact name="body" defaultValue="[B]x[/B]" />),
  );
  expect(html).not.toContain(`aria-label="${text.sourceLabel}"`);
  expect(html).toContain('name="body"');
  expect(html).toContain('value="[B]x[/B]"');
});

test("the text an editor opens with is what its field holds until the member changes it", () => {
  const source = "[b]loose[/b]\r\n\r\n\r\n\r\ntext";
  const html = renderToStaticMarkup(
    withIntl(<Editor name="body" defaultValue={source} />),
  );
  expect(html).toContain(`value="${source}"`);
});
