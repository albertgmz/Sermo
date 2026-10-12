import assert from "node:assert/strict";
import { test } from "node:test";
import { stripMarkdownHtml, stripMarkdownImages } from "./lite-markdown";
import { parseLiteCookie } from "./lite-preferences";

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

test("preserves unused ordinary reference definitions", () => {
  const input =
    'A signature.\n\n[docs]: https://example.test/guide\n  "Documentation"\n';
  assert.equal(stripMarkdownImages(input), input);
});

test("removes only definitions used exclusively by blocked images", () => {
  const input =
    "![blocked][frame] ![allowed][photo]\n\n[frame]: /frames/619.png\n[photo]: https://pictures.test/photo.png\n[docs]: https://example.test/guide";
  const result = stripMarkdownImages(input, parseLiteCookie("frames"));
  assert.ok(!result.includes("/frames/619.png"));
  assert.ok(!result.includes("[frame]:"));
  assert.ok(result.includes("![allowed][photo]"));
  assert.ok(result.includes("[photo]: https://pictures.test/photo.png"));
  assert.ok(result.includes("[docs]: https://example.test/guide"));
});

test("preserves local image definitions shared with ordinary links", () => {
  const input = "![frame][shared] [visit][shared]\n\n[shared]: /frames/619.png";
  const result = stripMarkdownImages(input, parseLiteCookie("frames"));
  assert.ok(!result.includes("![frame]"));
  assert.ok(result.includes("[visit][shared]"));
  assert.ok(result.includes("[shared]: /frames/619.png"));
});

for (const url of [
  "/frames/619.png",
  "/%66rames/619.png",
  "/frames%2F619.png",
  "/frames\\619.png",
  "/avatars/../frames/619.png",
  "/avatars/%2E%2E/frames/619.png",
  "https://forum.test/frames/619.png",
  "https://forum.test/%66rames/619.png?size=40#preview",
]) {
  test(`blocks a registered local Markdown image at ${url}`, () => {
    assert.equal(
      stripMarkdownImages(
        `Before ![frame](<${url}>) after.`,
        parseLiteCookie("frames"),
        "https://forum.test",
      ),
      "Before LITE MODE after.",
    );
  });
}

test("allows unrelated local and remote Markdown images with a category selection", () => {
  const input =
    "![avatar](/avatars/tobi.jpg) ![remote](https://pictures.test/frames/619.png)";
  assert.equal(
    stripMarkdownImages(input, parseLiteCookie("frames"), "https://forum.test"),
    input,
  );
});

test("postImages blocks remote and local Markdown images", () => {
  const result = stripMarkdownImages(
    "![remote](https://pictures.test/photo.png) ![frame](/frames/619.png)",
    parseLiteCookie("postImages"),
  );
  assert.equal(result, "LITE MODE LITE MODE");
});

test("off preserves Markdown images and reference definitions", () => {
  const input =
    "![remote](https://pictures.test/photo.png) ![frame][pic]\n\n[pic]: /frames/619.png";
  assert.equal(stripMarkdownImages(input, parseLiteCookie()), input);
});

for (const markup of [
  '<img src="https://pictures.test/photo.png">',
  '<picture><source srcset="https://pictures.test/photo.png"><img src="https://pictures.test/fallback.png"></picture>',
  '<source src="https://pictures.test/photo.png">',
  '<video poster="https://pictures.test/photo.png"><source src="https://pictures.test/movie.mp4"></video>',
  '<audio src="https://pictures.test/audio.mp3">media fallback</audio>',
  '<svg><path d="M123 456 L789 101"/></svg>',
  '<object data="https://pictures.test/photo.png">media fallback</object>',
  '<embed src="https://pictures.test/photo.png">',
  '<iframe src="https://pictures.test/photo.png">media fallback</iframe>',
  '<div style="background-image: url(https://pictures.test/photo.png)">media fallback</div>',
  '<table background="url(https://pictures.test/photo.png)"><tr><td>media fallback</td></tr></table>',
  '<IMG SRC="https://pictures.test/photo.png">',
  '<SPAN STYLE="background: URL(https://pictures.test/photo.png)">media fallback</SPAN>',
]) {
  test(`removes blocked media-bearing HTML ${markup.split(">", 1)[0]}>`, () => {
    const result = stripMarkdownImages(
      `Before ${markup} after.`,
      parseLiteCookie("postImages"),
    );
    assert.ok(result.startsWith("Before "));
    assert.ok(result.endsWith(" after."));
    assert.ok(!result.includes("pictures.test"));
    assert.ok(!result.includes("M123 456 L789 101"));
    assert.ok(!result.includes("media fallback"));
    assert.ok(!result.includes("<"));
  });
}

test("removes multiline SVG including path data between separate Markdown nodes", () => {
  const input =
    'Before <svg>\n\n<path d="M123 456 L789 101"/>\n\n</svg> after.';
  const result = stripMarkdownImages(input, parseLiteCookie("postImages"));
  assert.ok(result.startsWith("Before "));
  assert.ok(result.endsWith(" after."));
  assert.ok(!result.includes("<"));
  assert.ok(!result.includes("M123 456 L789 101"));
});

test("local categories block raw HTML media and its enclosing picture", () => {
  const input =
    'Before <picture><source srcset="https://forum.test/%66rames/619.png"><img src="https://pictures.test/fallback.png"></picture> after.';
  const result = stripMarkdownImages(
    input,
    parseLiteCookie("frames"),
    "https://forum.test",
  );
  assert.ok(result.startsWith("Before "));
  assert.ok(result.endsWith(" after."));
  assert.ok(!result.includes("619.png"));
  assert.ok(!result.includes("fallback.png"));
  assert.ok(!result.includes("<"));
});

test("local categories block HTML CSS URLs with case-insensitive attributes", () => {
  const result = stripMarkdownImages(
    'Before <span STYLE="background: URL(/%66rames/619.png)">media fallback</span> after.',
    parseLiteCookie("frames"),
  );
  assert.ok(!result.includes("619.png"));
  assert.ok(!result.includes("media fallback"));
  assert.ok(result.startsWith("Before "));
  assert.ok(result.endsWith(" after."));
});

test("preserves allowed raw HTML and ordinary HTML source formatting", () => {
  const input =
    'Before <em title="ordinary">text</em> <img src="https://pictures.test/photo.png"> <svg><path d="M1 2"/></svg> after.';
  assert.equal(
    stripMarkdownImages(input, parseLiteCookie("frames"), "https://forum.test"),
    input,
  );
  const ordinary = '<div style="font-weight: bold">Ordinary text.</div>';
  assert.equal(stripMarkdownImages(ordinary), ordinary);
});

test("HTML in inline, fenced, and indented code is exempt", () => {
  const input = [
    '`<img src="https://pictures.test/inline.png">`',
    "",
    "```html",
    '<svg><path d="M123 456"/></svg>',
    '<img src="/frames/619.png">',
    "```",
    "",
    '    <img src="https://pictures.test/indented.png">',
    '    <div style="background: url(/frames/619.png)">example</div>',
  ].join("\n");
  assert.equal(stripMarkdownImages(input), input);
});

test("the server HTML pass preserves Markdown images for their image renderer", () => {
  const input =
    '![image](/frames/619.png) <svg><path d="secret"/></svg> `<img src="example">`';
  assert.equal(
    stripMarkdownHtml(input, parseLiteCookie("all")),
    '![image](/frames/619.png) LITE MODE `<img src="example">`',
  );
});

test("media CSS URLs can span lines and use HTML entities", () => {
  const input =
    '<div style="background: url(\n&#47;frames/619.png\n)">fallback</div>';
  assert.equal(
    stripMarkdownImages(input, parseLiteCookie("frames")),
    "LITE MODE",
  );
});
