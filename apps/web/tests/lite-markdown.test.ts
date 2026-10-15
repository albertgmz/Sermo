import { expect, test } from "bun:test";
import { stripHtmlMedia, stripMarkdownImages } from "../src/lib/lite-markdown";

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
  expect(output).toContain("Before DATA SAVER after.");
  expect(output).toContain("[DATA SAVER](/thread/42)");
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
    "DATA SAVER [visit][shared]\n\n[shared]: https://example.test/page",
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
  expect(output).not.toContain("DATA SAVER");
  expect(output).not.toContain("pictures.test");
  expect(output).toContain("Before  after.");
});

test("HTML filtering replaces pictures and the elements around them, and leaves the rest", () => {
  const html =
    '<p>a <a href="https://example.test/x">link</a></p>' +
    '<picture><source srcset="https://pictures.test/a.webp 1x"><img src="/x.png"></picture>' +
    '<p>text <img src="https://pictures.test/b.png"> end</p>';
  const all = { master: true, blocked: [] };
  const output = stripHtmlMedia(html, all);
  expect(output).toBe(
    '<p>a <a href="https://example.test/x">link</a></p>DATA SAVER<p>text DATA SAVER end</p>',
  );
  expect(stripHtmlMedia(html, { master: false, blocked: [] })).toBe(html);
  // Another category alone does not touch a remote picture.
  const remote = '<p><img src="https://pictures.test/b.png"></p>';
  expect(stripHtmlMedia(remote, { master: false, blocked: ["avatars"] })).toBe(
    remote,
  );
  expect(
    stripHtmlMedia(remote, { master: false, blocked: ["postImages"] }),
  ).toBe("<p>DATA SAVER</p>");
});

test("an embedded player becomes a link to its page when pictures are blocked", () => {
  const player =
    '<iframe class="bb-media bb-media-video bb-media-youtube" src="https://www.youtube-nocookie.com/embed/kQ0Eo1UccEE" loading="lazy" allowfullscreen data-media-url="https://www.youtube.com/watch?v=kQ0Eo1UccEE"></iframe>';
  const html = `<p>watch ${player} now</p>`;
  expect(stripHtmlMedia(html, { master: false, blocked: ["postImages"] })).toBe(
    '<p>watch <a href="https://www.youtube.com/watch?v=kQ0Eo1UccEE" rel="nofollow ugc noopener">https://www.youtube.com/watch?v=kQ0Eo1UccEE</a> now</p>',
  );
  expect(stripHtmlMedia(html, { master: true, blocked: [] })).toContain(
    '<a href="https://www.youtube.com/watch?v=kQ0Eo1UccEE"',
  );
  expect(stripHtmlMedia(html, { master: false, blocked: [] })).toBe(html);
  // Without a page address (or with an unsafe one) it is the usual label.
  const bare = '<iframe src="https://player.vimeo.com/video/1"></iframe>';
  expect(stripHtmlMedia(bare, { master: true, blocked: [] })).toBe(
    "DATA SAVER",
  );
  const unsafe =
    '<iframe src="https://player.vimeo.com/video/1" data-media-url="javascript:alert(1)"></iframe>';
  expect(stripHtmlMedia(unsafe, { master: true, blocked: [] })).toBe(
    "DATA SAVER",
  );
});
