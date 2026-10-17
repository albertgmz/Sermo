import type { Deadline } from "./deadline";
import { mediaHtml, resolveMedia } from "./media";

/**
 * Stage one of reading BB code: the tags of a source and which of them pair up. Both stages are
 * linear: tags are read at each `[` with a bounded look-ahead, a stack pairs openers with
 * closers (every entry is pushed once and popped once), and the literal tags (CODE, PLAIN, ...)
 * find their closer through a cached forward search. A tag that is unknown, malformed or never
 * paired stays literal text; nothing between the tags is looked at here.
 */

const MAX_OPTION_LENGTH = 200;
/** A link address can be longer than the other options. */
const MAX_URL_OPTION_LENGTH = 2_000;

/** One tag of the source (text between tags is not a token: it is the gap between two). */
export interface Tok {
  kind: "open" | "close" | "atom";
  start: number;
  end: number;
  /** Upper case; `*` for a list item. */
  name: string;
  /** The option with its quotes and surrounding space removed. */
  option?: string;
  /** Open and close tokens: part of a pair. Atoms are always live. */
  live: boolean;
  /** Atoms: what the tag holds, already validated. */
  text?: string;
  href?: string;
  html?: string;
  /** A `[/HR]` with no `[HR]` before it: swallowed, as if it had not been typed. */
  stray?: boolean;
  id?: string;
  size?: string;
  language?: string;
  /** MEDIA: whether the embed is a player or only a link. */
  embed?: "iframe" | "link";
}

/** Tags whose content is read as BB code. */
const CONTAINERS = new Set([
  "B",
  "I",
  "U",
  "S",
  "COLOR",
  "FONT",
  "SIZE",
  "URL",
  "EMAIL",
  "ISPOILER",
  "ICODE",
  "CODE",
  "LEFT",
  "CENTER",
  "RIGHT",
  "JUSTIFY",
  "INDENT",
  "QUOTE",
  "SPOILER",
  "LIST",
  "TABLE",
  "HEADING",
  "TR",
  "TH",
  "TD",
  "*",
]);

/** Tags that stay inside a line; everything else a container can be is a block. */
const INLINE_NAMES = new Set([
  "B",
  "I",
  "U",
  "S",
  "COLOR",
  "FONT",
  "SIZE",
  "URL",
  "EMAIL",
  "ISPOILER",
  "ICODE",
]);

/** Tags that do not make sense inside rich code. */
const BLOCK_NAMES = new Set([
  "CODE",
  "LEFT",
  "CENTER",
  "RIGHT",
  "JUSTIFY",
  "INDENT",
  "QUOTE",
  "SPOILER",
  "LIST",
  "TABLE",
  "HEADING",
  "TR",
  "TH",
  "TD",
  "*",
]);

const ATOM_NAMES = new Set(["PLAIN", "IMG", "MEDIA", "ATTACH", "USER", "HR"]);

const COLORS = new Set(
  (
    "black silver gray grey white maroon red purple fuchsia green lime olive yellow navy blue teal " +
    "aqua orange pink brown gold cyan magenta violet indigo crimson coral salmon khaki turquoise " +
    "tan lightgray lightgrey darkgray darkgrey"
  ).split(" "),
);
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
/** The one pattern of a color the sanitizer lets through a span's style. */
export const COLOR_STYLE = new RegExp(
  `^(?:#(?:[0-9a-f]{3}|[0-9a-f]{6})|${[...COLORS].join("|")})$`,
  "i",
);
const FONTS = [
  "Arial",
  "Book Antiqua",
  "Courier New",
  "Georgia",
  "Tahoma",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
];
export const FONT_CLASS = new Map(
  FONTS.map((font) => [font.toLowerCase(), font.toLowerCase().replace(/ /g, "-")]),
);
/**
 * One character of an address: no space, control character, bracket, angle bracket, double quote,
 * backtick or backslash (an apostrophe is fine: it is escaped where it is written).
 */
export const ADDRESS_CHAR = '[^\\s<>"`\\\\\\[\\]\\u0000-\\u001f\\u007f]';
export const URL_PATTERN = new RegExp(`^https?:\\/\\/${ADDRESS_CHAR}{1,2000}$`, "i");
/** A link to a page of the site itself: a path from the root, never `//host`. */
const SITE_PATH = new RegExp(`^\\/(?!\\/)${ADDRESS_CHAR}{0,2000}$`);
const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,200}\.[A-Za-z]{2,24}$/;
/** Longest content a literal tag is checked against; anything longer cannot be valid. */
const MAX_LITERAL_CONTENT = 2_100;

export function colorValue(option: string | undefined): string | null {
  if (!option) return null;
  const value = option.toLowerCase();
  return HEX_COLOR.test(value) || COLORS.has(value) ? value : null;
}

function optionAllowed(name: string, option: string | undefined): boolean {
  switch (name) {
    case "COLOR":
      return colorValue(option) !== null;
    case "FONT":
      return option !== undefined && FONT_CLASS.has(option.toLowerCase());
    case "SIZE":
      return option !== undefined && /^[1-7]$/.test(option);
    case "URL":
      return option !== undefined && (URL_PATTERN.test(option) || SITE_PATH.test(option));
    case "EMAIL":
      return option !== undefined && EMAIL_PATTERN.test(option);
    case "ICODE":
      return option?.toLowerCase() === "rich";
    case "CODE":
      return option !== undefined && /^[A-Za-z0-9+#._-]{1,20}$/.test(option);
    case "QUOTE":
    case "SPOILER":
      return true;
    case "INDENT":
      return option === undefined || /^[1-5]$/.test(option);
    case "LIST":
      return option === undefined || option === "1";
    case "HEADING":
      return option !== undefined && /^[1-3]$/.test(option);
    default:
      return option === undefined;
  }
}

interface Head {
  close: boolean;
  name: string;
  option: string | undefined;
  end: number;
}

function isLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

/** The tag that starts at `at` (a `[`), or null: `[/?NAME]` or `[NAME=option]`, bounded. */
function readHead(source: string, at: number): Head | null {
  let p = at + 1;
  const close = source.charCodeAt(p) === 47;
  if (close) p++;
  const nameStart = p;
  if (source.charCodeAt(p) === 42) {
    p++;
  } else {
    while (p - nameStart < 10 && isLetter(source.charCodeAt(p))) p++;
    if (p === nameStart) return null;
  }
  const name = source.slice(nameStart, p).toUpperCase();
  const next = source.charCodeAt(p);
  if (next === 93) return { close, name, option: undefined, end: p + 1 };
  if (next !== 61 || close) return null;
  p++;
  const mark = source.charCodeAt(p);
  const quoted = mark === 34 || mark === 39;
  const from = quoted ? p + 1 : p;
  const link = name === "URL";
  // A quote's author is a member's name, which may hold brackets and a double quote: in double
  // quotes it ends only at a double quote that closes the tag, as an apostrophe does below.
  const named = mark === 34 && name === "QUOTE";
  const limit = Math.min(source.length, from + (link ? MAX_URL_OPTION_LENGTH : MAX_OPTION_LENGTH));
  let q = from;
  for (; q < limit; q++) {
    const code = source.charCodeAt(q);
    // An address has no bracket, so a link option stops at the next one and the scan stays short.
    if ((code === 93 && !named) || code === 10 || (link && code === 91)) break;
    // A double quote ends the option unless it is single-quoted; an apostrophe ends it only
    // when the tag closes right after it.
    if (mark === 39 || named ? code === mark && source.charCodeAt(q + 1) === 93 : code === 34)
      break;
  }
  if (quoted) {
    if (source.charCodeAt(q) !== mark || source.charCodeAt(q + 1) !== 93) return null;
    return { close, name, option: source.slice(from, q).trim(), end: q + 2 };
  }
  if (source.charCodeAt(q) !== 93) return null;
  return { close, name, option: source.slice(from, q).trim(), end: q + 1 };
}

/** Finds `[/NAME]`; a search that failed or found something is not repeated for later tags. */
class Closers {
  private found = new Map<string, { start: number; end: number } | null>();
  private patterns = new Map<string, RegExp>();

  constructor(private readonly source: string) {}

  find(name: string, from: number): { start: number; end: number } | null {
    const known = this.found.get(name);
    if (known === null) return null;
    if (known && known.start >= from) return known;
    let pattern = this.patterns.get(name);
    if (!pattern) {
      pattern = new RegExp(String.raw`\[\/${name}\]`, "gi");
      this.patterns.set(name, pattern);
    }
    pattern.lastIndex = from;
    const hit = pattern.exec(this.source);
    const result = hit ? { start: hit.index, end: hit.index + hit[0].length } : null;
    this.found.set(name, result);
    return result;
  }
}

type AtomTok = Pick<Tok, "text" | "href" | "html" | "id" | "size" | "language" | "embed">;

/** What a literal tag holds, or null when its content is not valid (the tag stays text). */
function atomFor(head: Head, inner: string): AtomTok | null {
  const { name, option } = head;
  switch (name) {
    case "CODE":
      return { text: inner, language: option };
    case "ICODE":
    case "PLAIN":
      return { text: inner };
    case "IMG": {
      const href = inner.trim();
      return inner.length <= MAX_LITERAL_CONTENT && URL_PATTERN.test(href) ? { href } : null;
    }
    case "URL": {
      const text = inner.trim();
      if (inner.length > MAX_LITERAL_CONTENT) return null;
      // Like a bare address, www.example.com is a link to https://www.example.com.
      const href = /^www\./i.test(text) ? `https://${text}` : text;
      return URL_PATTERN.test(href) ? { href, text } : null;
    }
    case "EMAIL": {
      const address = inner.trim();
      return inner.length <= MAX_LITERAL_CONTENT && EMAIL_PATTERN.test(address)
        ? { href: `mailto:${address}`, text: address }
        : null;
    }
    case "MEDIA": {
      const site = option!.toLowerCase();
      if (inner.length > MAX_LITERAL_CONTENT) return null;
      const media = resolveMedia(site, inner.trim());
      return media
        ? { html: mediaHtml(site, media), href: media.url, id: site, embed: media.kind }
        : null;
    }
    case "ATTACH": {
      const id = inner.trim();
      if (inner.length > 40 || !/^[1-9]\d{0,11}$/.test(id)) return null;
      return { id, size: option?.toLowerCase() === "full" ? "full" : "thumb" };
    }
    case "USER": {
      const label = inner.trim();
      return label && label.length <= 100 ? { id: option, text: label } : null;
    }
  }
  return null;
}

/** Whether a tag with this head reads its content as text up to its closer. */
function isLiteralHead(head: Head): boolean {
  const { name, option } = head;
  switch (name) {
    case "CODE":
      return (
        option === undefined ||
        (option.toLowerCase() !== "rich" && /^[A-Za-z0-9+#._-]{1,20}$/.test(option))
      );
    case "ICODE":
      return option === undefined;
    case "PLAIN":
    case "IMG":
    case "URL":
    case "EMAIL":
      return option === undefined;
    case "MEDIA":
      return option !== undefined && /^[a-z]+$/i.test(option);
    case "ATTACH":
      return option === undefined || /^(?:full|thumb)$/i.test(option);
    case "USER":
      return option !== undefined && /^[1-9]\d{0,8}$/.test(option);
  }
  return false;
}

function token(kind: Tok["kind"], head: Head, at: number, live: boolean): Tok {
  return { kind, start: at, end: head.end, name: head.name, option: head.option, live };
}

/** Reads every tag of the source. Open and close tokens are not paired yet. */
export function lex(source: string, deadline: Deadline): Tok[] {
  const toks: Tok[] = [];
  const closers = new Closers(source);
  let at = source.indexOf("[");
  while (at >= 0) {
    deadline.tick();
    const head = readHead(source, at);
    let next = at + 1;
    if (head && (CONTAINERS.has(head.name) || ATOM_NAMES.has(head.name))) {
      if (head.close) {
        if (CONTAINERS.has(head.name) && head.name !== "*") {
          toks.push(token("close", head, at, false));
          next = head.end;
        } else if (head.name === "HR") {
          // XenForo writes a rule as [HR][/HR]: the closer is swallowed.
          toks.push({ ...token("atom", head, at, true), stray: true });
          next = head.end;
        }
      } else if (head.name === "HR") {
        if (head.option === undefined) {
          toks.push(token("atom", head, at, true));
          next = head.end;
        }
      } else if (isLiteralHead(head)) {
        const close = closers.find(head.name, head.end);
        const content = close ? atomFor(head, source.slice(head.end, close.start)) : null;
        if (close && content) {
          const tok = token("atom", { ...head, end: close.end }, at, true);
          toks.push(Object.assign(tok, content));
          next = close.end;
        }
      } else if (CONTAINERS.has(head.name) && optionAllowed(head.name, head.option)) {
        toks.push(token("open", head, at, false));
        next = head.end;
      }
    }
    at = source.indexOf("[", next);
  }
  return toks;
}

interface Entry {
  tok: number;
  name: string;
  /** Inline entries at the top of the stack down to and including this one. */
  run: number;
  /** A rich-code opener: how many tags it had skipped when it opened. */
  skipsAtOpen?: number;
  /**
   * A LIST, TABLE or TR: the tokens of what it holds that become live only with it (its `[*]`
   * items, its rows and cells), so a cell of a table that never closes stays literal.
   */
  deferred?: number[];
}

const HOLDS = new Set(["LIST", "TABLE", "TR"]);
const isRich = (tok: Tok): boolean =>
  (tok.name === "CODE" || tok.name === "ICODE") && tok.option?.toLowerCase() === "rich";

/**
 * Pairs openers with closers. A closer pairs with the nearest open tag of its name; tags opened
 * after it that are still open are left literal. `[*]` pairs with its list, `[TR]` with its table
 * and `[TD]`/`[TH]` with their row, and each is a literal when it is not directly there or when
 * what holds it is not paired. In rich code only inline tags pair.
 */
export function pair(toks: Tok[], deadline: Deadline): void {
  // Rich code turns block tags inside it into text; if its opener then never pairs (a tag closes
  // over it), those tags were wrongly skipped: pair again with that opener left as text.
  const excluded = new Set<number>();
  for (let round = 0; round < 3; round++) {
    const wrong = pairOnce(toks, deadline, excluded);
    if (wrong.size === 0) return;
    for (const index of wrong) excluded.add(index);
  }
  pairOnce(toks, deadline, excluded);
}

function pairOnce(toks: Tok[], deadline: Deadline, excluded: ReadonlySet<number>): Set<number> {
  for (const tok of toks) if (tok.kind !== "atom") tok.live = false;
  const stack: Entry[] = [];
  const open = new Map<string, number>();
  const wrong = new Set<number>();
  let rich = 0;
  let skipped = 0;

  const drop = (matched = false): void => {
    const entry = stack.pop()!;
    if (entry.name !== "*") open.set(entry.name, open.get(entry.name)! - 1);
    if (isRich(toks[entry.tok]!)) {
      rich--;
      if (!matched && skipped > entry.skipsAtOpen!) wrong.add(entry.tok);
    }
  };
  const push = (index: number, name: string): void => {
    const below = stack.length ? stack[stack.length - 1]!.run : 0;
    const deferred = HOLDS.has(name) ? [] : undefined;
    stack.push({
      tok: index,
      name,
      run: INLINE_NAMES.has(name) ? below + 1 : 0,
      deferred,
      skipsAtOpen: skipped,
    });
    if (name !== "*") open.set(name, (open.get(name) ?? 0) + 1);
    if (isRich(toks[index]!)) rich++;
  };

  // A rich-code opener with no closer left after it is text, and must not turn later tags into text.
  const closable = new Set<number>();
  const closers = new Map<string, number>();
  for (let index = toks.length - 1; index >= 0; index--) {
    const tok = toks[index]!;
    if (tok.kind === "close") {
      closers.set(tok.name, (closers.get(tok.name) ?? 0) + 1);
    } else if (tok.kind === "open" && isRich(tok) && closers.get(tok.name)) {
      closers.set(tok.name, closers.get(tok.name)! - 1);
      closable.add(index);
    }
  }

  for (let index = 0; index < toks.length; index++) {
    deadline.tick();
    const tok = toks[index]!;
    if (tok.kind === "atom") continue;
    const top = stack[stack.length - 1];
    if (tok.kind === "open") {
      if (isRich(tok) && (excluded.has(index) || !closable.has(index))) continue;
      if (rich > 0 && BLOCK_NAMES.has(tok.name)) {
        skipped++;
        continue;
      }
      if (tok.name === "*") {
        if (!top || !open.get("LIST")) continue;
        const holder = stack.length - 1 - top.run;
        const entry = stack[holder];
        if (!entry || (entry.name !== "LIST" && entry.name !== "*")) continue;
        while (stack.length - 1 > holder) drop();
        const list = entry.name === "*" ? stack[holder - 1]! : entry;
        if (entry.name === "*") drop();
        list.deferred!.push(index);
        push(index, "*");
        continue;
      }
      if (tok.name === "TR" && top?.name !== "TABLE") continue;
      if ((tok.name === "TD" || tok.name === "TH") && top?.name !== "TR") continue;
      push(index, tok.name);
      continue;
    }
    if (!open.get(tok.name)) continue;
    while (stack[stack.length - 1]!.name !== tok.name) drop();
    const entry = stack[stack.length - 1]!;
    if (tok.name === "TR" || tok.name === "TD" || tok.name === "TH") {
      // Live when the row or table holding it is.
      const holder = stack[stack.length - 2]!.deferred!;
      holder.push(entry.tok, index);
      for (const held of entry.deferred ?? []) holder.push(held);
    } else {
      toks[entry.tok]!.live = tok.live = true;
      for (const held of entry.deferred ?? []) toks[held]!.live = true;
    }
    drop(true);
  }
  // Rich code still open at the end never paired.
  for (const entry of stack)
    if (isRich(toks[entry.tok]!) && skipped > entry.skipsAtOpen!) wrong.add(entry.tok);
  return wrong;
}
