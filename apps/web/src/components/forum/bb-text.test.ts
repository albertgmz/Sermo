import { expect, test } from "bun:test";
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

test("a body of unclosed code tags is read in linear time", () => {
  const start = performance.now();
  quoted("[CODE]".repeat(20000));
  expect(performance.now() - start).toBeLessThan(1000);
});

test("a mention is plain when the name can be, else quoted", () => {
  expect(mentionOf("wren")).toBe("@wren");
  expect(mentionOf("two words")).toBe('@"two words"');
});
