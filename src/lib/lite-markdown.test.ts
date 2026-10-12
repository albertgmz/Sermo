import assert from "node:assert/strict";
import { test } from "node:test";
import { stripMarkdownImages } from "./lite-markdown";

test("strips inline and nested image syntax without changing links", () => {
  const input =
    'Before ![photo](https://pictures.test/a_(b).jpg "caption") after [![alt](https://pictures.test/b.png)](/thread).';
  const result = stripMarkdownImages(input);
  assert.ok(!result.includes("pictures.test"));
  assert.ok(result.includes("[LITE MODE](/thread)"));
  assert.ok(result.startsWith("Before LITE MODE after"));
  assert.equal(
    stripMarkdownImages("A [link](https://pictures.test/a.jpg)."),
    "A [link](https://pictures.test/a.jpg).",
  );
});

test("strips full, collapsed, and shortcut image references and their definitions", () => {
  const input =
    '![one][pic] ![pic][] ![pic]\n\n[pic]: https://pictures.test/a.jpg\n  "a title"\n';
  const result = stripMarkdownImages(input);
  assert.ok(!result.includes("pictures.test"));
  assert.ok(!result.includes("!["));
  assert.ok(!result.includes("a title"));
});

test("preserves a shared reference used by an ordinary link", () => {
  const result = stripMarkdownImages(
    "![picture][shared] [visit][shared]\n\n[shared]: https://example.test/page",
  );
  assert.ok(!result.includes("!["));
  assert.ok(result.includes("[visit][shared]"));
  assert.ok(result.includes("[shared]: https://example.test/page"));
});

test("keeps source formatting and code samples that are not pictures", () => {
  const input =
    "**text**\n\n`![example](code)`\n\n```md\n![example](code)\n```\n\n[link](/where)";
  assert.equal(stripMarkdownImages(input), input);
});
