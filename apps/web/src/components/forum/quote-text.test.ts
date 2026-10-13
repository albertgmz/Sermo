import { expect, test } from "bun:test";
import { quoteOf } from "./quote-text";

const quoted = (source: string) => quoteOf(5, "ember", source);

test("a plain body is wrapped in the quote container", () => {
  expect(quoted("Hello\n\nWorld")).toBe(
    ':::quote{post=5 author="ember"}\nHello\n\nWorld\n:::',
  );
});

test("a line of three colons in the body no longer closes the quote", () => {
  expect(quoted("one\n:::\ntwo")).toBe(
    ':::quote{post=5 author="ember"}\none\n :::\ntwo\n:::',
  );
});

test("a nested quote that is closed is kept as it is", () => {
  const inner = ':::quote{post=2 author="wren"}\nolder\n:::\nnewer';
  expect(quoted(inner)).toBe(`:::quote{post=5 author="ember"}\n${inner}\n:::`);
});

test("an opening line with no closing line of its own is made plain text", () => {
  expect(quoted(":::spoiler\nsecret")).toBe(
    ':::quote{post=5 author="ember"}\n :::spoiler\nsecret\n:::',
  );
});

test("container lines inside a code block are left alone, and an open block is closed", () => {
  const code = "```\n:::\n:::quote{post=1}\n```";
  expect(quoted(code)).toBe(`:::quote{post=5 author="ember"}\n${code}\n:::`);
  expect(quoted("```\ncode\n:::")).toBe(
    ':::quote{post=5 author="ember"}\n```\ncode\n:::\n```\n:::',
  );
});
