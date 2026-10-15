import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

// The editor hands on a server action.
mock.module("server-only", () => ({}));

const { ThreadTags } = await import("./thread-tags");
const { ThreadTagsEditor } = await import("./thread-tags-editor");
const { ThreadTagsField } = await import("./thread-tags-field");

test("each tag is a link to its page, in a list named for them", () => {
  const html = renderToStaticMarkup(
    withIntl(<ThreadTags tags={["rust", "café"]} />),
  );
  expect(html).toContain('aria-label="Tags"');
  expect(html).toContain('href="/tags/rust"');
  expect(html).toContain('href="/tags/caf%C3%A9"');
  expect(html).toContain(">#café<");
});

test("a thread with no tags draws nothing", () => {
  expect(renderToStaticMarkup(withIntl(<ThreadTags tags={[]} />))).toBe("");
});

test("the field is named tags and holds the current ones as hashtags", () => {
  const html = renderToStaticMarkup(
    withIntl(<ThreadTagsField defaultValue="#a #b" />),
  );
  expect(html).toContain('name="tags"');
  expect(html).toContain('value="#a #b"');
  expect(html).toContain("Letters, numbers and _ only.");
});

test("the editor starts as one button that says what it does", () => {
  const edit = renderToStaticMarkup(
    withIntl(<ThreadTagsEditor threadId={4} tags={["a"]} />),
  );
  expect(edit).toContain("Edit tags");
  expect(edit).not.toContain('name="tags"');
  const add = renderToStaticMarkup(
    withIntl(<ThreadTagsEditor threadId={4} tags={[]} />),
  );
  expect(add).toContain("Add tags");
});
