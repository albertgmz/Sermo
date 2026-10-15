import assert from "node:assert/strict";
import { test } from "node:test";
import { stripBbCodeImages, stripHtmlMedia } from "./lite-content";
import { parseLiteCookie } from "./lite-preferences";

test("strips a picture tag and leaves the link around it", () => {
  const input =
    "Before [IMG]https://pictures.test/a_(b).jpg[/IMG] after [URL=/thread][IMG]https://pictures.test/b.png[/IMG][/URL].";
  const result = stripBbCodeImages(input);
  assert.ok(!result.includes("pictures.test"));
  assert.ok(result.includes("[URL=/thread]DATA SAVER[/URL]"));
  assert.ok(result.startsWith("Before DATA SAVER after"));
  assert.equal(
    stripBbCodeImages("A [URL=https://pictures.test/a.jpg]link[/URL]."),
    "A [URL=https://pictures.test/a.jpg]link[/URL].",
  );
});

test("keeps source formatting, links to pictures and code samples that are not pictures", () => {
  const input =
    "[B]text[/B]\n\n[URL=https://example.test/file.jpg]download[/URL]\n\n[ICODE][IMG]https://pictures.test/a.png[/IMG][/ICODE]\n\n[CODE]\n[IMG]https://pictures.test/a.png[/IMG]\n[/CODE]\n\n[PLAIN][IMG]https://pictures.test/a.png[/IMG][/PLAIN]\n\n[IMG]never closed";
  assert.equal(stripBbCodeImages(input), input);
  assert.equal(stripBbCodeImages(""), "");
});

test("a picture tag is read in any case and with spaces around its address", () => {
  assert.equal(
    stripBbCodeImages("[img] https://pictures.test/a.png [/IMG] x"),
    "DATA SAVER x",
  );
});

test("a picture can be dropped without a label, as signatures do", () => {
  assert.equal(
    stripBbCodeImages(
      "Before [IMG]https://pictures.test/a.png[/IMG] after.",
      undefined,
      undefined,
      "",
    ),
    "Before  after.",
  );
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
  test(`blocks a local picture at ${url}`, () => {
    assert.equal(
      stripBbCodeImages(
        `Before [IMG]${url}[/IMG] after.`,
        parseLiteCookie("frames"),
        "https://forum.test",
      ),
      "Before DATA SAVER after.",
    );
  });
}

test("a category selection blocks local pictures, which belong to none, and leaves remote ones", () => {
  const input =
    "[IMG]/pictures/tobi.jpg[/IMG] [IMG]https://pictures.test/pictures/ring.png[/IMG]";
  assert.equal(
    stripBbCodeImages(input, parseLiteCookie("frames"), "https://forum.test"),
    "DATA SAVER [IMG]https://pictures.test/pictures/ring.png[/IMG]",
  );
  assert.equal(
    stripBbCodeImages(input, parseLiteCookie(), "https://forum.test"),
    input,
  );
});

test("postImages blocks remote and local pictures", () => {
  assert.equal(
    stripBbCodeImages(
      "[IMG]https://pictures.test/photo.png[/IMG] [IMG]/pictures/ring.png[/IMG]",
      parseLiteCookie("postImages"),
    ),
    "DATA SAVER DATA SAVER",
  );
});

test("off preserves pictures", () => {
  const input =
    "[IMG]https://pictures.test/photo.png[/IMG] [IMG]/pictures/ring.png[/IMG]";
  assert.equal(stripBbCodeImages(input, parseLiteCookie()), input);
});

test("a long text of picture tags and unclosed ones is read in a short time", () => {
  const input = `${"[IMG]https://pictures.test/a.png[/IMG] [CODE] [IMG] ".repeat(2000)}`;
  const start = performance.now();
  stripBbCodeImages(input);
  assert.ok(performance.now() - start < 500);
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
    const result = stripHtmlMedia(
      `<p>Before ${markup} after.</p>`,
      parseLiteCookie("postImages"),
    );
    assert.ok(result.startsWith("<p>Before "));
    assert.ok(result.endsWith(" after.</p>"));
    assert.ok(!result.includes("pictures.test"));
    assert.ok(!result.includes("M123 456 L789 101"));
    assert.ok(!result.includes("media fallback"));
    assert.ok(
      !/<(?:img|picture|source|video|audio|svg|object|embed|iframe)/i.test(
        result,
      ),
    );
  });
}

test("removes multiline SVG including path data", () => {
  const input =
    '<p>Before <svg>\n\n<path d="M123 456 L789 101"/>\n\n</svg> after.</p>';
  const result = stripHtmlMedia(input, parseLiteCookie("postImages"));
  assert.equal(result, "<p>Before DATA SAVER after.</p>");
});

test("local categories block HTML media and its enclosing picture", () => {
  const input =
    '<p>Before <picture><source srcset="https://forum.test/%66rames/619.png"><img src="https://pictures.test/fallback.png"></picture> after.</p>';
  const result = stripHtmlMedia(
    input,
    parseLiteCookie("frames"),
    "https://forum.test",
  );
  assert.equal(result, "<p>Before DATA SAVER after.</p>");
});

test("local categories block HTML CSS URLs with case-insensitive attributes", () => {
  const result = stripHtmlMedia(
    '<p>Before <span STYLE="background: URL(/%66rames/619.png)">media fallback</span> after.</p>',
    parseLiteCookie("frames"),
  );
  assert.equal(result, "<p>Before DATA SAVER after.</p>");
});

test("preserves allowed HTML and the pictures of other categories", () => {
  const input =
    '<p>Before <em title="ordinary">text</em> <img src="https://pictures.test/photo.png"> <svg><path d="M1 2"/></svg> after.</p>';
  assert.equal(
    stripHtmlMedia(input, parseLiteCookie("frames"), "https://forum.test"),
    input,
  );
  const ordinary = '<div style="font-weight: bold">Ordinary text.</div>';
  assert.equal(stripHtmlMedia(ordinary, parseLiteCookie("all")), ordinary);
});

test("media CSS URLs can span lines and use HTML entities", () => {
  const input =
    '<div style="background: url(\n&#47;pictures/ring.png\n)">fallback</div>';
  assert.equal(stripHtmlMedia(input, parseLiteCookie("frames")), "DATA SAVER");
});

test("text that looks like a media tag is escaped by the backend and is never touched", () => {
  const html =
    "<p>Use the &lt;video&gt; tag for clips.</p><p>Array&lt;object&gt; and &lt;svg&gt; files</p>";
  assert.equal(stripHtmlMedia(html, parseLiteCookie("postImages")), html);
});

test("a closed element disappears whole, URL included", () => {
  assert.equal(
    stripHtmlMedia(
      '<p>a <video src="https://pictures.test/v.mp4">fallback</video> b</p>',
      parseLiteCookie("postImages"),
    ),
    "<p>a DATA SAVER b</p>",
  );
});

test("a caller can name the label that stands in for a blocked picture", () => {
  const html = '<p>a <img src="/pictures/ring.png"> b</p>';
  assert.equal(
    stripHtmlMedia(html, { master: true, blocked: [] }, undefined, "AHORRO"),
    "<p>a AHORRO b</p>",
  );
});
