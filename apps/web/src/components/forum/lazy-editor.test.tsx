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
    "components/forum/attachment-field.tsx",
    "app/(main)/members/wall-composer.tsx",
    "app/(main)/members/post-composer.tsx",
    "app/(main)/conversations/[id]/reply-form.tsx",
  ]) {
    const imports = source(path).match(/^import (?!type )[^;]*;/gm) ?? [];
    for (const line of imports) {
      expect(line, path).not.toMatch(/forum\/editor|lexical/);
    }
  }
});
