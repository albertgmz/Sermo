import { expect, test } from "bun:test";
import { renderBbCode } from "../../../../../packages/core/src/render";
import { mentionOf, quoteOf } from "./bb-text";

const quoted = (source: string) => quoteOf(5, "ember", 9, source);

test("a post is quoted with its author, post and member", () => {
  expect(quoted("Hello\n\nWorld")).toBe(
    '[QUOTE="ember, post: 5, member: 9"]Hello\n\nWorld[/QUOTE]',
  );
});

test("a name the tag cannot hold is cleaned and one with nothing left is a placeholder", () => {
  expect(quoteOf(1, 'a"b], c\nd', 2, "x")).toBe(
    '[QUOTE="a b c d, post: 1, member: 2"]x[/QUOTE]',
  );
  expect(quoteOf(1, '"]', 2, "x")).toContain('[QUOTE="member, post: 1');
});

test("a closing quote tag in the body no longer ends the quote", () => {
  expect(quoted("one [/QUOTE] two")).toBe(
    '[QUOTE="ember, post: 5, member: 9"]one [PLAIN][/QUOTE][/PLAIN] two[/QUOTE]',
  );
});

test("a quote opened in the body and never closed no longer swallows the closing tag", () => {
  expect(quoted("[QUOTE=wren]older")).toBe(
    '[QUOTE="ember, post: 5, member: 9"][PLAIN][QUOTE=wren][/PLAIN]older[/QUOTE]',
  );
});

test("quotes inside the body that are closed stay quotes", () => {
  const inner = '[QUOTE="wren, post: 2, member: 1"]older[/QUOTE]\nnewer';
  expect(quoted(inner)).toBe(
    `[QUOTE="ember, post: 5, member: 9"]${inner}[/QUOTE]`,
  );
});

test("quote tags inside code are not tags and are left as written", () => {
  const code = "[CODE]\n[/QUOTE]\n[QUOTE]\n[/CODE] and [ICODE][/QUOTE][/ICODE]";
  expect(quoted(code)).toBe(
    `[QUOTE="ember, post: 5, member: 9"]${code}[/QUOTE]`,
  );
});

test("a tag that reads its content as it is and never closes no longer takes a later closing tag", () => {
  for (const open of [
    "[CODE]",
    "[ICODE]",
    "[PLAIN]",
    "[IMG]",
    "[URL]",
    "[MEDIA=youtube]",
    "[ATTACH]",
    "[EMAIL]",
    "[USER=5]",
  ]) {
    const out = quoted(`use the ${open} tag`);
    expect(out, open).toContain(`[PLAIN]${open}[/PLAIN]`);
    expect(out.endsWith("[/QUOTE]"), open).toBe(true);
  }
  // With its closing tag in the body it is left alone, and a link with an option is no such tag.
  expect(quoted("[URL]https://a.test[/URL] [URL=https://a.test]x")).toBe(
    '[QUOTE="ember, post: 5, member: 9"][URL]https://a.test[/URL] [URL=https://a.test]x[/QUOTE]',
  );
});

test("a closing tag with no opener in the body no longer pairs with one before the quote", () => {
  const out = quoted("fixed [/B] and [/URL] and [/SPOILER]");
  expect(out).toBe(
    '[QUOTE="ember, post: 5, member: 9"]fixed [PLAIN][/B][/PLAIN] and [PLAIN][/URL][/PLAIN] and [PLAIN][/SPOILER][/PLAIN][/QUOTE]',
  );
  // Tags closed in the body are left alone.
  const kept = "[B]a[/B] [LIST][*]x[/LIST]";
  expect(quoted(kept)).toBe(
    `[QUOTE="ember, post: 5, member: 9"]${kept}[/QUOTE]`,
  );
  // Written after an unclosed [B], the quote is still a quote.
  const html = renderBbCode(`[B]open ${quoted("a [/B] b")} after`);
  expect(html).toContain('<blockquote class="bb-quote">');
});

test("a player tag with an id the renderer does not take no longer hides a quote tag", () => {
  const out = quoted('[MEDIA=youtube]x[QUOTE="q, post: 1, member: 2"][/MEDIA]');
  expect(out).toContain('[PLAIN][QUOTE="q, post: 1, member: 2"][/PLAIN]');
  // A valid one is left alone.
  const valid = "[MEDIA=youtube]kQ0Eo1UccEE[/MEDIA]";
  expect(quoted(valid)).toBe(
    `[QUOTE="ember, post: 5, member: 9"]${valid}[/QUOTE]`,
  );
});

test("a capital letter of another alphabet does not move what is found after it", () => {
  const body = "İİİ [CODE]\n[/QUOTE]\n[/CODE] [QUOTE]";
  expect(quoted(body)).toBe(
    '[QUOTE="ember, post: 5, member: 9"]İİİ [CODE]\n[/QUOTE]\n[/CODE] [PLAIN][QUOTE][/PLAIN][/QUOTE]',
  );
});

test("a body of unclosed code tags is read in linear time", () => {
  const start = performance.now();
  quoted("[CODE]".repeat(20000));
  expect(performance.now() - start).toBeLessThan(1000);
});

test("a mention is plain when the name can be, else quoted", () => {
  expect(mentionOf("wren")).toBe("@wren");
  expect(mentionOf("two words")).toBe('@"two words"');
});

test("a body of many unpaired quote tags is read in a short time", () => {
  const start = performance.now();
  const out = quoted("[QUOTE]".repeat(40000));
  expect(performance.now() - start).toBeLessThan(1000);
  expect(
    out.startsWith('[QUOTE="ember, post: 5, member: 9"][PLAIN][QUOTE][/PLAIN]'),
  ).toBe(true);
});

test("tags written the way XenForo writes them are paired like the renderer pairs them", () => {
  // A closing JUSTIFY with no opener in the body no longer pairs with one before the quote.
  expect(quoted("a [/JUSTIFY] b")).toBe(
    `[QUOTE="ember, post: 5, member: 9"]a [PLAIN][/JUSTIFY][/PLAIN] b[/QUOTE]`,
  );
  const kept = "[JUSTIFY]a[/JUSTIFY]";
  expect(quoted(kept)).toBe(
    `[QUOTE="ember, post: 5, member: 9"]${kept}[/QUOTE]`,
  );
  // A quote with an option in apostrophes is a quote: balanced ones stay, a lone closer is text.
  const inner = `[QUOTE='O'Brien, post: 1']x[/QUOTE]`;
  expect(quoted(inner)).toBe(
    `[QUOTE="ember, post: 5, member: 9"]${inner}[/QUOTE]`,
  );
  expect(quoted(`[QUOTE='Say "hi"']open`)).toBe(
    `[QUOTE="ember, post: 5, member: 9"][PLAIN][QUOTE='Say "hi"'][/PLAIN]open[/QUOTE]`,
  );
});
