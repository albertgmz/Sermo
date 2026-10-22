import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { messages, messagesFor } from "../src/i18n/messages";
import { LOCALE_DIRS, MESSAGES } from "./locales";

// Every language keeps the English catalogue's shape: the same files, the same keys, and in each
// message the same arguments, the same plural/select structure and the same rich-text tags. Only
// the words may differ, so a translation can never drop a value or a tag the code passes in.

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type Node =
  | { kind: "text" }
  | { kind: "pound" }
  | { kind: "arg"; name: string; type: string }
  | { kind: "choice"; name: string; type: string; cases: [string, Node[]][] }
  | { kind: "tag"; name: string; children: Node[] };

// A reader for the subset of ICU MessageFormat the interface text uses. Text is dropped: only the
// structure around it is kept.
function parse(message: string): Node[] {
  let at = 0;

  function text(): void {
    // Quoted text (`'{'`) and doubled apostrophes are literal text.
    if (message[at] === "'" && message[at + 1] === "'") {
      at += 2;
    } else if (message[at] === "'" && /[{}<>]/.test(message[at + 1] ?? "")) {
      at += 1;
      while (at < message.length && message[at] !== "'") at += 1;
      at += 1;
    } else {
      at += 1;
    }
  }

  function skipSpace() {
    while (/\s/.test(message[at] ?? "")) at += 1;
  }

  function word() {
    const start = at;
    while (at < message.length && /[^\s,{}]/.test(message[at] ?? "")) at += 1;
    return message.slice(start, at);
  }

  function nodes(stop: "end" | "brace" | { closing: string }): Node[] {
    const out: Node[] = [];
    let pendingText = false;
    const flush = () => {
      if (pendingText) out.push({ kind: "text" });
      pendingText = false;
    };
    while (at < message.length) {
      const char = message[at];
      if (stop === "brace" && char === "}") break;
      if (char === "{") {
        flush();
        out.push(argument());
      } else if (char === "#" && stop === "brace") {
        flush();
        out.push({ kind: "pound" });
        at += 1;
      } else if (char === "<") {
        const close = /^<\/([A-Za-z][\w-]*)\s*>/.exec(message.slice(at));
        const open = /^<([A-Za-z][\w-]*)\s*(\/?)>/.exec(message.slice(at));
        if (close) {
          if (typeof stop === "object" && stop.closing === close[1]) {
            flush();
            at += close[0].length;
            return out;
          }
          throw new Error(`stray closing tag </${close[1]}> in: ${message}`);
        }
        if (open) {
          flush();
          at += open[0].length;
          const name = open[1] as string;
          out.push({
            kind: "tag",
            name,
            children: open[2] ? [] : nodes({ closing: name }),
          });
        } else {
          pendingText = true;
          at += 1;
        }
      } else {
        pendingText = true;
        text();
      }
    }
    flush();
    if (typeof stop === "object")
      throw new Error(`unclosed <${stop.closing}> in: ${message}`);
    return out;
  }

  function argument(): Node {
    at += 1; // {
    skipSpace();
    const name = word();
    skipSpace();
    if (message[at] === "}") {
      at += 1;
      return { kind: "arg", name, type: "" };
    }
    if (message[at] !== ",") throw new Error(`bad argument in: ${message}`);
    at += 1;
    skipSpace();
    const type = word();
    skipSpace();
    if (type !== "plural" && type !== "select" && type !== "selectordinal") {
      // number, date, time with an optional style
      let style = "";
      if (message[at] === ",") {
        at += 1;
        const start = at;
        while (at < message.length && message[at] !== "}") at += 1;
        style = message.slice(start, at).trim();
      }
      at += 1; // }
      return { kind: "arg", name, type: `${type}${style ? `,${style}` : ""}` };
    }
    if (message[at] !== ",") throw new Error(`bad ${type} in: ${message}`);
    at += 1;
    const cases: [string, Node[]][] = [];
    skipSpace();
    while (message[at] !== "}") {
      const selector = word();
      skipSpace();
      if (message[at] !== "{")
        throw new Error(`missing branch for ${selector} in: ${message}`);
      at += 1;
      cases.push([selector, nodes("brace")]);
      at += 1; // }
      skipSpace();
      if (at >= message.length) throw new Error(`unclosed ${type}: ${message}`);
    }
    at += 1; // }
    return { kind: "choice", name, type, cases };
  }

  return nodes("end");
}

// What a message needs from the code, as a set (word order differs between languages, and a
// branch may drop a `#`): each argument with its type, each plural/select with its selectors, each
// rich-text tag. Spanish may add the plural category `many`; nothing else may differ.
function parts(list: Node[], out = new Set<string>()): Set<string> {
  for (const node of list) {
    if (node.kind === "arg")
      out.add(`{${node.name}${node.type ? `,${node.type}` : ""}}`);
    else if (node.kind === "tag") {
      out.add(`<${node.name}>`);
      parts(node.children, out);
    } else if (node.kind === "choice") {
      const selectors = node.cases
        .map(([selector]) => selector)
        .filter((selector) => !(node.type === "plural" && selector === "many"))
        .sort();
      out.add(`{${node.name},${node.type}|${selectors.join("|")}}`);
      for (const [, body] of node.cases) parts(body, out);
    }
  }
  return out;
}

const signature = (list: Node[]) => [...parts(list)].sort().join(" ");

function leaves(value: Json, path = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof value === "string") {
    out.set(path, value);
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value))
      for (const [sub, text] of leaves(child, path ? `${path}.${key}` : key))
        out.set(sub, text);
  } else {
    throw new Error(`${path}: a message must be a string`);
  }
  return out;
}

const read = (locale: string, file: string) =>
  JSON.parse(readFileSync(join(MESSAGES, locale, file), "utf8")) as Json;

const OTHERS = LOCALE_DIRS.filter((locale) => locale !== "en");
const FILES = readdirSync(join(MESSAGES, "en")).sort();

test("the reader tells arguments, plurals, selects and tags apart", () => {
  expect(
    signature(
      parse(
        "Hi {name}, you have {count, plural, one {# <b>new</b> reply} other {# replies}} " +
          "({kind, select, a {x} other {y {n, number}}}). '{'quoted'}' <shop>Go</shop>",
      ),
    ),
  ).toBe(
    "<b> <shop> {count,plural|one|other} {kind,select|a|other} {n,number} {name}",
  );
  expect(() => parse("<b>open")).toThrow();
  expect(signature(parse("a 'it''s' b"))).toBe("");
});

test("word order and a missing # do not matter, a changed argument or tag does", () => {
  const same = (a: string, b: string) =>
    signature(parse(a)) === signature(parse(b));
  const en =
    "{n, plural, one {# <b>x</b> of {who}} other {# <b>x</b> of {who}}}";
  expect(
    same(
      en,
      "{who} de <b>x</b>: {n, plural, one {uno} many {# millones} other {# <b>x</b> {who}}}",
    ),
  ).toBe(true);
  expect(same(en, en.replace("{who}", "{whom}"))).toBe(false);
  expect(same(en, en.replaceAll("<b>x</b>", "x"))).toBe(false);
  expect(same(en, en.replace(" other {# <b>x</b> of {who}}", ""))).toBe(false);
});

test("every language has exactly the English message files", () => {
  expect(FILES.length).toBe(36);
  for (const locale of OTHERS)
    expect(readdirSync(join(MESSAGES, locale)).sort(), locale).toEqual(FILES);
});

for (const locale of OTHERS) {
  for (const file of FILES) {
    test(`${locale}/${file} keeps the keys, arguments, plurals and tags of English`, () => {
      const source = leaves(read("en", file));
      const target = leaves(read(locale, file));
      expect([...target.keys()].sort(), "keys").toEqual(
        [...source.keys()].sort(),
      );
      for (const [key, english] of source) {
        const translated = target.get(key) as string;
        expect(signature(parse(translated)), `${file}: ${key}`).toBe(
          signature(parse(english)),
        );
      }
    });
  }
}

test("every English message parses", () => {
  for (const file of FILES)
    for (const [key, text] of leaves(read("en", file)))
      expect(() => parse(text), `${file}: ${key}`).not.toThrow();
});

test("each language loads as the same set of namespaces as the typed English catalogue", async () => {
  for (const locale of LOCALE_DIRS) {
    const loaded = await messagesFor(locale as "en");
    expect(Object.keys(loaded).sort(), locale).toEqual(
      Object.keys(messages).sort(),
    );
  }
});
