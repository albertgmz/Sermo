import { expect, test } from "bun:test";
import { Deadline } from "../../../../../packages/core/src/bbcode/deadline";
import {
  lex,
  pair,
  URL_PATTERN,
} from "../../../../../packages/core/src/bbcode/scan";
import {
  isCodeLanguage,
  isLinkAddress,
  isWebAddress,
  linkAddressOf,
  TAG_SOURCE,
} from "./bb-scan";

// The editor reads addresses and tags the way the renderer does: these keep the two in step.
const ADDRESSES = [
  "https://example.com",
  "http://example.com/a?b=1#c",
  "HTTPS://EXAMPLE.COM",
  "https://exa mple.com",
  "https://a.test/<b>",
  'https://a.test/"x',
  "https://a.test/a[1]",
  "https://a.test/\\x",
  "https://a.test/`x",
  "https://a.test/\u0007",
  "https://",
  "ftp://a.test",
  "javascript:alert(1)",
  "//a.test",
  "/path",
  "www.example.com",
  `https://a.test/${"x".repeat(2000)}`,
];

test("an address is a web address for the editor when it is for the renderer", () => {
  for (const address of ADDRESSES) {
    expect(isWebAddress(address), address.slice(0, 40)).toBe(
      URL_PATTERN.test(address),
    );
  }
});

test("a path of the site is a link, a path to another host is not", () => {
  expect(isLinkAddress("/forums/1")).toBe(true);
  expect(isLinkAddress("/")).toBe(true);
  expect(isLinkAddress("//a.test")).toBe(false);
  expect(isLinkAddress("javascript:alert(1)")).toBe(false);
});

test("a typed address becomes the one a link can have, or nothing", () => {
  expect(linkAddressOf(" https://a.test/x ")).toBe("https://a.test/x");
  expect(linkAddressOf("/forums")).toBe("/forums");
  expect(linkAddressOf("www.example.com")).toBe("https://www.example.com");
  expect(linkAddressOf("example.com/a")).toBe("https://example.com/a");
  expect(linkAddressOf("javascript:alert(1)")).toBeNull();
  expect(linkAddressOf("not an address")).toBeNull();
  expect(linkAddressOf("")).toBeNull();
});

test("a code language is one the renderer takes", () => {
  expect(isCodeLanguage("ts")).toBe(true);
  expect(isCodeLanguage("c++")).toBe(true);
  expect(isCodeLanguage("rich")).toBe(false);
  expect(isCodeLanguage("a b")).toBe(false);
  expect(isCodeLanguage("x".repeat(21))).toBe(false);
});

const SOURCES = [
  "[B]a[/B] [i]b[/i] [U]c[/U] [S]d[/S]",
  "[URL=https://a.test/x]a[/URL] [URL=/forums]b[/URL]",
  "[HEADING=2]a[/HEADING]",
  "[LIST]\n[*]a\n[*]b\n[/LIST] [LIST=1][*]x[/LIST]",
  '[QUOTE]a[/QUOTE] [QUOTE="wren, post: 1, member: 2"]b[/QUOTE]',
  "[CODE=ts]x[/CODE] [ICODE]y[/ICODE] [PLAIN][B][/PLAIN]",
  "[B][I]x[/B][/I] [B]never closed [/I]",
];

test("every tag the renderer pairs is a tag for the editor too", () => {
  for (const source of SOURCES) {
    const toks = lex(source, new Deadline());
    pair(toks, new Deadline());
    const tags = [...source.matchAll(new RegExp(TAG_SOURCE, "g"))];
    for (const tok of toks.filter((t) => t.kind !== "atom" && t.live)) {
      const found = tags.find((tag) => tag.index === tok.start);
      expect(found, `${source}: ${tok.name} at ${tok.start}`).toBeDefined();
      expect(found?.[2].toUpperCase()).toBe(tok.name);
      expect(found?.[1] !== undefined).toBe(tok.kind === "close");
      expect((found?.[3] ?? found?.[4])?.trim()).toBe(tok.option);
    }
  }
});
