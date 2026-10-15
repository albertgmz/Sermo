import { expect, test } from "bun:test";
import { stripBbCodeImages, stripHtmlMedia } from "../src/lib/lite-content";

export const PICTURE_BB_CODE = [
  "Before [IMG]https://pictures.test/a_(b).jpg[/IMG] after.",
  "[URL=/thread/42][IMG]https://pictures.test/linked.png[/IMG][/URL]",
  "[IMG]https://pictures.test/one.png[/IMG] [img]https://pictures.test/two.png[/img]",
  "[URL=https://example.test/page]ordinary[/URL] and [B]bold[/B].",
].join("\n");

test("BB code filtering strips plain, linked and repeated pictures", () => {
  const output = stripBbCodeImages(PICTURE_BB_CODE);
  expect(output).not.toContain("pictures.test");
  expect(output).not.toContain("[IMG]");
  expect(output).toContain("Before DATA SAVER after.");
  expect(output).toContain("[URL=/thread/42]DATA SAVER[/URL]");
  expect(output).toContain("[URL=https://example.test/page]ordinary[/URL]");
  expect(output).toContain("[B]bold[/B]");
});

test("ordinary text, links to picture files and code samples retain their source formatting", () => {
  const input =
    "[B]Text[/B]\n\n[URL=https://example.test/file.jpg]download[/URL]\n\n[ICODE][IMG]sample.png[/IMG][/ICODE]\n\n[CODE=bbcode]\n[IMG]https://pictures.test/a.png[/IMG]\n[/CODE]\n";
  expect(stripBbCodeImages(input)).toBe(input);
  expect(stripBbCodeImages("")).toBe("");
});

test("a picture can be dropped without a label, as signatures do", () => {
  const output = stripBbCodeImages(PICTURE_BB_CODE, undefined, undefined, "");
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
