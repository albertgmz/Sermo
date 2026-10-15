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
  isOtherTag,
  isWebAddress,
  linkAddressOf,
  literalContentOk,
  readsLiterally,
  TAG_SOURCE,
  tagOf,
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
  `[URL="https://a.test/${"x".repeat(300)}"]long[/URL] [QUOTE="a]b"]x[/QUOTE]`,
  `[QUOTE="${"n".repeat(250)}"]long name[/QUOTE]`,
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

// The tags the editor shows as text are the tags the renderer pairs, with the options it takes.
const OPTIONS = [
  undefined,
  "",
  "1",
  "3",
  "9",
  "red",
  "Red",
  "#f00",
  "#ff0000",
  "#ff00",
  "notacolour",
  "arial",
  "Times New Roman",
  "verdana",
  "comic sans",
  "a@b.co",
  "not an email",
  "full",
  "thumb",
  "youtube",
  "ts",
  "rich",
  "Title of it",
];
const OTHER_NAMES = [
  "COLOR",
  "FONT",
  "SIZE",
  "EMAIL",
  "SPOILER",
  "QUOTE",
  "INDENT",
  "ISPOILER",
  "LEFT",
  "CENTER",
  "RIGHT",
  "TABLE",
];

test("the tags the editor shows as text are the ones the renderer pairs", () => {
  for (const name of OTHER_NAMES) {
    for (const option of OPTIONS) {
      const head = option === undefined ? `[${name}]` : `[${name}=${option}]`;
      const toks = lex(`${head}x[/${name}]`, new Deadline());
      // EMAIL with no option reads its content, which is another tag.
      const opens = toks.filter((t) => t.kind === "open" && t.name === name);
      const expected =
        name === "EMAIL" && option === undefined
          ? false
          : isOtherTag(name, option);
      expect(opens.length > 0, `${head}`).toBe(expected);
    }
  }
});

test("the tags that read their content as text are the ones the renderer reads that way", () => {
  const CONTENT: Record<string, string> = {
    CODE: "let a",
    ICODE: "a",
    PLAIN: "a",
    IMG: "https://a.test/a.png",
    URL: "https://a.test",
    EMAIL: "a@b.co",
    MEDIA: "kQ0Eo1UccEE",
    ATTACH: "12",
    USER: "wren",
  };
  for (const [name, content] of Object.entries(CONTENT)) {
    for (const option of OPTIONS) {
      if (option === "rich" && (name === "CODE" || name === "ICODE")) continue;
      const head = option === undefined ? `[${name}]` : `[${name}=${option}]`;
      const toks = lex(`${head}${content}[/${name}]`, new Deadline());
      const atom = toks.some((t) => t.kind === "atom" && t.name === name);
      // MEDIA is only checked by the renderer for its player ids.
      if (name === "MEDIA") continue;
      expect(
        readsLiterally(name, option) && literalContentOk(name, content),
        head,
      ).toBe(atom);
    }
  }
});

test("a tag option is read as the renderer reads it", () => {
  const long = (n: number) => "x".repeat(n);
  for (const source of [
    `[QUOTE=${long(200)}]a[/QUOTE]`,
    `[QUOTE=${long(201)}]a[/QUOTE]`,
    `[QUOTE="${long(201)}"]a[/QUOTE]`,
    `[URL=https://a.test/${long(1900)}]a[/URL]`,
    `[URL="https://a.test/${long(300)}"]a[/URL]`,
    "[URL=https://a.test/[x]]a[/URL]",
    "[QUOTE=a[b]x[/QUOTE]",
    '[QUOTE="a]b"]x[/QUOTE]',
    '[QUOTE="a"b"]x[/QUOTE]',
    "[SPOILER=a\nb]x[/SPOILER]",
  ]) {
    const toks = lex(source, new Deadline()).filter((t) => t.kind !== "atom");
    const mine = [...source.matchAll(new RegExp(TAG_SOURCE, "g"))]
      .map((m) => ({ m, tag: tagOf(m) }))
      .filter(({ tag }) => tag !== null)
      .map(({ m, tag }) => `${m.index}:${tag?.name}`);
    // Every tag the renderer reads, the editor reads too.
    for (const tok of toks) {
      expect(mine, source.slice(0, 40)).toContain(`${tok.start}:${tok.name}`);
    }
  }
});
