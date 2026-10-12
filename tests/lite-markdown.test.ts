import { expect, test } from "bun:test";
import { stripMarkdownImages } from "../src/lib/lite-markdown";

export const PICTURE_MARKDOWN = [
  'Before ![inline](https://pictures.test/a_(b).jpg "caption") after.',
  "[![linked](https://pictures.test/linked.png)](/thread/42)",
  "![full][photo] ![photo][] ![photo]",
  "[linked reference][destination] and [ordinary](https://example.test/page).",
  "",
  "[photo]: <https://pictures.test/reference.png>",
  '  "Photo title"',
  "[destination]: /destination",
].join("\n");

test("Markdown filtering strips inline, reference, collapsed, shortcut and linked pictures", () => {
  const output = stripMarkdownImages(PICTURE_MARKDOWN);
  expect(output).not.toContain("pictures.test");
  expect(output).not.toContain("Photo title");
  expect(output).not.toContain("![");
  expect(output).toContain("Before LITE MODE after.");
  expect(output).toContain("[LITE MODE](/thread/42)");
  expect(output).toContain("[linked reference][destination]");
  expect(output).toContain("[destination]: /destination");
  expect(output).toContain("[ordinary](https://example.test/page)");
});

test("ordinary text, image-looking links and code samples retain their source formatting", () => {
  const input =
    "**Text**  \n\n[download](https://example.test/file.jpg)\n\n`![code](sample.png)`\n\n```md\n![code](sample.png)\n```\n";
  expect(stripMarkdownImages(input)).toBe(input);
  const shared =
    "![picture][shared] [visit][shared]\n\n[shared]: https://example.test/page";
  expect(stripMarkdownImages(shared)).toBe(
    "LITE MODE [visit][shared]\n\n[shared]: https://example.test/page",
  );
  expect(stripMarkdownImages("")).toBe("");
});

test("a picture can be dropped without a label, as signatures do", () => {
  const output = stripMarkdownImages(
    PICTURE_MARKDOWN,
    undefined,
    undefined,
    "",
  );
  expect(output).not.toContain("LITE MODE");
  expect(output).not.toContain("pictures.test");
  expect(output).toContain("Before  after.");
});
