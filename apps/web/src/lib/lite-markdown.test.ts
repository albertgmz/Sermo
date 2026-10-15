import assert from "node:assert/strict";
import { test } from "node:test";
import {
  stripHtmlMedia,
  stripMarkdownHtml,
  stripMarkdownImages,
} from "./lite-markdown";
import { parseLiteCookie } from "./lite-preferences";

test("strips inline and nested image syntax without changing links", () => {
  const input =
    'Before ![photo](https://pictures.test/a_(b).jpg "caption") after [![alt](https://pictures.test/b.png)](/thread).';
  const result = stripMarkdownImages(input);
  assert.ok(!result.includes("pictures.test"));
  assert.ok(result.includes("[DATA SAVER](/thread)"));
  assert.ok(result.startsWith("Before DATA SAVER after"));
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
    "![blocked][frame] ![allowed][photo]\n\n[frame]: /pictures/ring.png\n[photo]: https://pictures.test/photo.png\n[docs]: https://example.test/guide";
  const result = stripMarkdownImages(input, parseLiteCookie("frames"));
  assert.ok(!result.includes("/pictures/ring.png"));
  assert.ok(!result.includes("[frame]:"));
  assert.ok(result.includes("![allowed][photo]"));
  assert.ok(result.includes("[photo]: https://pictures.test/photo.png"));
  assert.ok(result.includes("[docs]: https://example.test/guide"));
});

test("preserves local image definitions shared with ordinary links", () => {
  const input =
    "![frame][shared] [visit][shared]\n\n[shared]: /pictures/ring.png";
  const result = stripMarkdownImages(input, parseLiteCookie("frames"));
  assert.ok(!result.includes("![frame]"));
  assert.ok(result.includes("[visit][shared]"));
  assert.ok(result.includes("[shared]: /pictures/ring.png"));
});

for (const url of [
  "/pictures/ring.png",
  "/%70ictures/ring.png",
  "/pictures%2Fring.png",
  "/pictures\\ring.png",
  "/media/../pictures/ring.png",
  "/media/%2E%2E/pictures/ring.png",
  "https://forum.test/pictures/ring.png",
  "https://forum.test/%70ictures/ring.png?size=40#preview",
]) {
  test(`blocks a local Markdown image at ${url}`, () => {
    assert.equal(
      stripMarkdownImages(
        `Before ![frame](<${url}>) after.`,
        parseLiteCookie("frames"),
        "https://forum.test",
      ),
      "Before DATA SAVER after.",
    );
  });
}

test("a category selection blocks local pictures, which belong to none, and leaves remote ones", () => {
  const input =
    "![avatar](/pictures/tobi.jpg) ![remote](https://pictures.test/pictures/ring.png)";
  assert.equal(
    stripMarkdownImages(input, parseLiteCookie("frames"), "https://forum.test"),
    "DATA SAVER ![remote](https://pictures.test/pictures/ring.png)",
  );
  assert.equal(
    stripMarkdownImages(input, parseLiteCookie(), "https://forum.test"),
    input,
  );
});

test("postImages blocks remote and local Markdown images", () => {
  const result = stripMarkdownImages(
    "![remote](https://pictures.test/photo.png) ![frame](/pictures/ring.png)",
    parseLiteCookie("postImages"),
  );
  assert.equal(result, "DATA SAVER DATA SAVER");
});

test("off preserves Markdown images and reference definitions", () => {
  const input =
    "![remote](https://pictures.test/photo.png) ![frame][pic]\n\n[pic]: /pictures/ring.png";
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
    '<img src="/pictures/ring.png">',
    "```",
    "",
    '    <img src="https://pictures.test/indented.png">',
    '    <div style="background: url(/pictures/ring.png)">example</div>',
  ].join("\n");
  assert.equal(stripMarkdownImages(input), input);
});

test("the server HTML pass preserves Markdown images for their image renderer", () => {
  const input =
    '![image](/pictures/ring.png) <svg><path d="secret"/></svg> `<img src="example">`';
  assert.equal(
    stripMarkdownHtml(input, parseLiteCookie("all")),
    '![image](/pictures/ring.png) DATA SAVER `<img src="example">`',
  );
});

test("media CSS URLs can span lines and use HTML entities", () => {
  const input =
    '<div style="background: url(\n&#47;pictures/ring.png\n)">fallback</div>';
  assert.equal(
    stripMarkdownImages(input, parseLiteCookie("frames")),
    "DATA SAVER",
  );
});

test("an element that is never closed loses only its opening tag", () => {
  const state = parseLiteCookie("postImages");
  const cases: [string, string][] = [
    [
      "Use the <video> tag for clips.\n\nSecond paragraph stays?\n\n- item",
      "Use the DATA SAVER tag for clips.\n\nSecond paragraph stays?\n\n- item",
    ],
    [
      "Array<object> and Map<string, embed> end",
      "ArrayDATA SAVER and Map<string, embed> end",
    ],
    [
      "I export <svg> files from Figma.\n\nNext para",
      "I export DATA SAVER files from Figma.\n\nNext para",
    ],
    // An end tag of an outer element abandons the open one inside it.
    ['a <div><video src="x.mp4"></div> tail', "a <div>DATA SAVER</div> tail"],
    [
      "<div>\n\nUse <video> tag\n\n</div>\n\nend",
      "<div>\n\nUse DATA SAVER tag\n\n</div>\n\nend",
    ],
    // Nested: the inner media element closes, the outer one stays open.
    [
      'a <video><source src="x.mp4"></video> b <audio> c\n\nd',
      "a DATA SAVER b DATA SAVER c\n\nd",
    ],
  ];
  for (const [input, expected] of cases)
    assert.equal(stripMarkdownImages(input, state), expected, input);
});

test("a closed element still disappears whole, URL included", () => {
  const state = parseLiteCookie("postImages");
  assert.equal(
    stripMarkdownImages(
      'a <video src="https://pictures.test/v.mp4">fallback</video> b',
      state,
    ),
    "a DATA SAVER b",
  );
});

test("the label of a removed picture can be left out", () => {
  assert.equal(
    stripMarkdownImages(
      "Hi ![a](https://pictures.test/a.png) <video> x\n\n![b][r]\n\n[r]: /pictures/1.png",
      undefined,
      undefined,
      "",
    ),
    "Hi   x\n\n\n\n",
  );
});

test("a caller can name the label that stands in for a blocked picture", () => {
  const html = '<p>a <img src="/pictures/ring.png"> b</p>';
  assert.equal(
    stripHtmlMedia(html, { master: true, blocked: [] }, undefined, "AHORRO"),
    "<p>a AHORRO b</p>",
  );
  assert.equal(
    stripMarkdownHtml(
      'a <img src="/pictures/ring.png"> b',
      { master: true, blocked: [] },
      undefined,
      "AHORRO",
    ),
    "a AHORRO b",
  );
});
