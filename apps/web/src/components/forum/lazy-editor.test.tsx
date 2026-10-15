import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { LazyEditor } from "./lazy-editor";

test("before it is entered it is a plain field of the form, with no formatting bar", () => {
  const html = renderToStaticMarkup(
    <LazyEditor name="body" placeholder="Write a message…" />,
  );
  expect(html).toContain("<textarea");
  expect(html).toContain('name="body"');
  expect(html).toContain('placeholder="Write a message…"');
  expect(html).not.toContain("toolbar");
  expect(html).not.toContain("contenteditable");
});

// A static import of the editor anywhere in these files would put its code back in the first
// load of the pages that show a one-line composer.
test("the one-line composers reach the editor's code only through the import made on entering", () => {
  const source = (path: string) =>
    readFileSync(join(import.meta.dir, "../..", path), "utf8");
  const lazy = source("components/forum/lazy-editor.tsx");
  expect(lazy).toContain('import("@/components/forum/editor")');
  for (const path of [
    "components/forum/lazy-editor.tsx",
    "components/forum/composer.tsx",
    "components/forum/attachment-field.tsx",
    "components/forum/line-composer.tsx",
    "app/[locale]/(main)/members/post-composer.tsx",
    "app/[locale]/(main)/conversations/[id]/reply-form.tsx",
    "app/[locale]/(main)/threads/[id]/reply-composer.tsx",
  ]) {
    const imports = source(path).match(/^import (?!type )[^;]*;/gm) ?? [];
    for (const line of imports) {
      expect(line, path).not.toMatch(/forum\/editor|lexical/);
    }
  }
});

test("the roomy plain field keeps the editor's padding and height, so the page does not move", () => {
  const html = renderToStaticMarkup(
    <LazyEditor name="body" placeholder="Write" compact={false} />,
  );
  expect(html).toContain("px-4 py-3");
  expect(html).toContain("min-height:120px");
  const compact = renderToStaticMarkup(
    <LazyEditor name="body" placeholder="Write" />,
  );
  expect(compact).toContain("px-3 py-2");
  expect(compact).toContain("min-height:40px");
});

// The edit pages and the new conversation page used to carry the whole editor in their first load.
// They show a plain box that becomes the editor when the member goes to write in it.
test("the edit pages and the new conversation page load the editor only on entering", () => {
  const source = (path: string) =>
    readFileSync(join(import.meta.dir, "../..", path), "utf8");
  for (const path of [
    "app/[locale]/(main)/threads/[id]/edit/[postId]/edit-post-form.tsx",
    "app/[locale]/(main)/conversations/[id]/edit/[messageId]/edit-message-form.tsx",
    "app/[locale]/(main)/conversations/new/new-conversation-form.tsx",
  ]) {
    const text = source(path);
    expect(text, path).toContain("<LazyEditor");
    const imports = text.match(/^import (?!type )[^;]*;/gm) ?? [];
    for (const line of imports) {
      expect(line, path).not.toMatch(/forum\/editor"|lexical/);
    }
  }
});

test("a box that edits what was written is a field that holds its BB code", () => {
  const html = renderToStaticMarkup(
    <LazyEditor
      name="body"
      placeholder="Write"
      compact={false}
      defaultValue={"[B]kept[/B]\n\n\n\nas written"}
    />,
  );
  expect(html).toContain("<textarea");
  expect(html).toContain("[B]kept[/B]");
  expect(html).toContain('name="body"');
});
