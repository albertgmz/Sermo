import type { Lexer, Parser, TokenizerAndRendererExtension, Tokens } from "marked";
import { ValidationError } from "../errors";
import {
  escapeHtml,
  MAX_QUOTE_DEPTH,
  MAX_SPOILER_DEPTH,
  renderSpoilerPlaceholder,
} from "./extensions";
import { highlightCode } from "./highlight";
import { mediaHtml, resolveMedia } from "./media";

/**
 * XenForo-style BB code, mixed with Markdown. Tags are case-insensitive; a tag that is unknown,
 * malformed or never closed stays literal text. Everything an author types is validated here and
 * the HTML is built from the validated parts.
 */

type Token = Tokens.Generic;
type InlineLexer = (text: string) => Token[];

const TOO_COMPLEX = "The text is too complex to display.";
const MAX_BB_DEPTH = 30;
/** Tag scans one render may spend; unclosed tags make every scan reach the end of the text. */
const SCAN_BUDGET = 400_000;

let budget = SCAN_BUDGET;
const depth = { quote: 0, spoiler: 0, total: 0 };

/** Called before each render that can hold BB code. */
export function resetBbCode(): void {
  budget = SCAN_BUDGET;
  depth.quote = depth.spoiler = depth.total = 0;
}

function spend(): void {
  if (--budget < 0)
    throw new ValidationError(TOO_COMPLEX, [{ path: ["body"], message: TOO_COMPLEX }]);
}

function nest<T>(kind: "quote" | "spoiler" | null, run: () => T): T {
  depth.total++;
  if (kind) depth[kind]++;
  try {
    if (
      depth.total > MAX_BB_DEPTH ||
      depth.quote > MAX_QUOTE_DEPTH ||
      depth.spoiler > MAX_SPOILER_DEPTH
    )
      throw new ValidationError("Containers are nested too deeply.", [
        {
          path: ["body"],
          message: `Containers may be nested at most ${MAX_QUOTE_DEPTH} levels deep.`,
        },
      ]);
    return run();
  } finally {
    depth.total--;
    if (kind) depth[kind]--;
  }
}

const OPEN_SOURCE = String.raw`\[([A-Za-z*]{1,10})(?:=("[^"\]\n]{0,200}"|[^\]\n"]{0,200}))?\]`;
const TAG_SOURCE = String.raw`\[(\/?)([A-Za-z*]{1,10})(?:=("[^"\]\n]{0,200}"|[^\]\n"]{0,200}))?\]`;
const OPEN_AT = new RegExp(OPEN_SOURCE, "y");

function normalizeOption(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const value = raw.startsWith('"') ? raw.slice(1, -1) : raw;
  return value.trim();
}

/** Content of these is never parsed (CODE and ICODE are literal unless given `rich`). */
function isLiteral(name: string, option: string | undefined): boolean {
  return (
    name === "PLAIN" || ((name === "CODE" || name === "ICODE") && option?.toLowerCase() !== "rich")
  );
}

/**
 * The closing tag matching an opening tag whose body starts at `from`: same-name tags nest, and
 * literal regions (CODE, ICODE, PLAIN) are skipped. Spoiler masking in plain-text paths uses the
 * same function, so what is hidden in the HTML is hidden there.
 */
export function findClose(
  source: string,
  from: number,
  name: string,
  option?: string,
): { start: number; end: number } | null {
  if (isLiteral(name, option)) {
    spend();
    const close = new RegExp(String.raw`\[\/${name}\]`, "gi");
    close.lastIndex = from;
    const found = close.exec(source);
    return found ? { start: found.index, end: found.index + found[0].length } : null;
  }
  const tags = new RegExp(TAG_SOURCE, "gi");
  tags.lastIndex = from;
  let level = 1;
  for (let match = tags.exec(source); match; match = tags.exec(source)) {
    spend();
    const tag = match[2]!.toUpperCase();
    if (match[1]) {
      if (tag === name && --level === 0)
        return { start: match.index, end: match.index + match[0].length };
    } else if (tag === name) {
      level++;
    } else if (isLiteral(tag, normalizeOption(match[3]))) {
      const skip = new RegExp(String.raw`\[\/${tag}\]`, "gi");
      skip.lastIndex = tags.lastIndex;
      const found = skip.exec(source);
      if (found) tags.lastIndex = found.index + found[0].length;
    }
  }
  return null;
}

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
const fontClass = new Map(
  FONTS.map((font) => [font.toLowerCase(), font.toLowerCase().replace(/ /g, "-")]),
);
const URL_PATTERN = /^https?:\/\/[^\s<>"'`\\]{1,2000}$/i;
const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,200}\.[A-Za-z]{2,24}$/;

function colorValue(option: string | undefined): string | null {
  if (!option) return null;
  const value = option.toLowerCase();
  return HEX_COLOR.test(value) || COLORS.has(value) ? value : null;
}

const INLINE_TAGS = new Set([
  "B",
  "I",
  "U",
  "S",
  "COLOR",
  "FONT",
  "SIZE",
  "URL",
  "EMAIL",
  "USER",
  "IMG",
  "MEDIA",
  "ICODE",
  "PLAIN",
  "ATTACH",
  "ISPOILER",
]);
const BLOCK_TAGS = new Set([
  "LEFT",
  "CENTER",
  "RIGHT",
  "QUOTE",
  "SPOILER",
  "CODE",
  "INDENT",
  "LIST",
  "TABLE",
  "HEADING",
  "PLAIN",
]);
const INLINE_CANDIDATE = new RegExp(String.raw`\[(?:${[...INLINE_TAGS].join("|")})(?=[\]=])`, "gi");
const BLOCK_CANDIDATE = new RegExp(String.raw`\[(?:${[...BLOCK_TAGS].join("|")})(?=[\]=])`, "gi");

function literal(text: string): Token {
  return { type: "sermoBbText", raw: text, text };
}

/** Rich code: BB tags render, Markdown does not. */
function richTokens(text: string): Token[] {
  const tokens: Token[] = [];
  let flushed = 0;
  let scan = 0;
  for (let at = text.indexOf("[", scan); at >= 0; at = text.indexOf("[", scan)) {
    const token = inlineToken(text.slice(at), richTokens, true);
    if (token) {
      if (at > flushed) tokens.push(literal(text.slice(flushed, at)));
      tokens.push(token);
      flushed = scan = at + token.raw.length;
    } else {
      scan = at + 1;
    }
  }
  if (flushed < text.length) tokens.push(literal(text.slice(flushed)));
  return tokens;
}

function optionAllowed(name: string, option: string | undefined): boolean {
  switch (name) {
    case "COLOR":
      return colorValue(option) !== null;
    case "FONT":
      return option !== undefined && fontClass.has(option.toLowerCase());
    case "SIZE":
      return option !== undefined && /^[1-7]$/.test(option);
    case "URL":
      return option === undefined || URL_PATTERN.test(option);
    case "EMAIL":
      return option === undefined || EMAIL_PATTERN.test(option);
    case "USER":
      return option !== undefined && /^[1-9]\d{0,8}$/.test(option);
    case "MEDIA":
      return option !== undefined && /^[a-z]+$/i.test(option);
    case "ICODE":
      return option === undefined || option.toLowerCase() === "rich";
    case "ATTACH":
      return option === undefined || /^(?:full|thumb)$/i.test(option);
    default:
      return option === undefined;
  }
}

function inlineToken(src: string, lex: InlineLexer, rich: boolean): Token | undefined {
  OPEN_AT.lastIndex = 0;
  const open = OPEN_AT.exec(src);
  if (!open) return;
  const name = open[1]!.toUpperCase();
  if (!INLINE_TAGS.has(name)) return;
  const option = normalizeOption(open[2]);
  if (!optionAllowed(name, option)) return;
  const close = findClose(src, open[0].length, name, option);
  if (!close) return;
  const inner = src.slice(open[0].length, close.start);
  const raw = src.slice(0, close.end);
  const content = () => nest(name === "ISPOILER" ? "spoiler" : null, () => lex(inner));
  switch (name) {
    case "B":
    case "I":
    case "U":
    case "S":
    case "ISPOILER":
      return { type: "sermoBbInline", raw, tag: name, tokens: content() };
    case "COLOR":
      return {
        type: "sermoBbInline",
        raw,
        tag: name,
        value: colorValue(option),
        tokens: content(),
      };
    case "FONT":
      return {
        type: "sermoBbInline",
        raw,
        tag: name,
        value: fontClass.get(option!.toLowerCase()),
        tokens: content(),
      };
    case "SIZE":
      return { type: "sermoBbInline", raw, tag: name, value: option, tokens: content() };
    case "URL": {
      const href = option ?? inner.trim();
      if (!URL_PATTERN.test(href)) return;
      return {
        type: "sermoBbInline",
        raw,
        tag: name,
        href,
        tokens: option === undefined ? [literal(href)] : content(),
      };
    }
    case "EMAIL": {
      const address = option ?? inner.trim();
      if (!EMAIL_PATTERN.test(address)) return;
      return {
        type: "sermoBbInline",
        raw,
        tag: name,
        href: `mailto:${address}`,
        tokens: option === undefined ? [literal(address)] : content(),
      };
    }
    case "USER": {
      const label = inner.trim();
      if (!label || label.length > 100) return;
      return {
        type: "sermoMention",
        raw,
        name: label,
        fallback: label,
        userIdHint: Number(option),
        blocked: rich,
      };
    }
    case "IMG": {
      const src = inner.trim();
      if (!URL_PATTERN.test(src)) return;
      return { type: "sermoBbInline", raw, tag: name, href: src };
    }
    case "MEDIA": {
      const site = option!.toLowerCase();
      const media = resolveMedia(site, inner.trim());
      if (!media) return;
      return { type: "sermoBbInline", raw, tag: name, html: mediaHtml(site, media) };
    }
    case "ICODE":
      return option === undefined
        ? { type: "sermoBbInline", raw, tag: name, text: inner }
        : { type: "sermoBbInline", raw, tag: name, tokens: richTokens(inner) };
    case "PLAIN":
      return { type: "sermoBbInline", raw, tag: name, text: inner };
    case "ATTACH": {
      const id = inner.trim();
      if (!/^[1-9]\d{0,11}$/.test(id)) return;
      return {
        type: "sermoBbInline",
        raw,
        tag: name,
        id,
        size: option?.toLowerCase() === "full" ? "full" : "thumb",
      };
    }
  }
}

const WRAP: Record<string, [string, string]> = {
  B: ["<strong>", "</strong>"],
  I: ["<em>", "</em>"],
  U: ["<u>", "</u>"],
  S: ["<del>", "</del>"],
};

export const bbInlineExtension: TokenizerAndRendererExtension = {
  name: "sermoBbInline",
  level: "inline",
  start(src) {
    INLINE_CANDIDATE.lastIndex = 0;
    for (let match = INLINE_CANDIDATE.exec(src); match; match = INLINE_CANDIDATE.exec(src)) {
      spend();
      const rest = src.slice(match.index);
      OPEN_AT.lastIndex = 0;
      const open = OPEN_AT.exec(rest);
      if (!open) continue;
      const name = open[1]!.toUpperCase();
      const option = normalizeOption(open[2]);
      if (!optionAllowed(name, option)) continue;
      if (findClose(rest, open[0].length, name, option)) return match.index;
    }
    return -1;
  },
  tokenizer(src) {
    const lexer = this.lexer;
    return inlineToken(src, (text) => lexer.inlineTokens(text) as Token[], false);
  },
  renderer(token) {
    const children = () => this.parser.parseInline(token.tokens ?? []);
    switch (token.tag) {
      case "B":
      case "I":
      case "U":
      case "S":
        return `${WRAP[token.tag]![0]}${children()}${WRAP[token.tag]![1]}`;
      case "COLOR":
        return `<span style="color:${token.value}">${children()}</span>`;
      case "FONT":
        return `<span class="bb-font-${token.value}">${children()}</span>`;
      case "SIZE":
        return `<span class="bb-size-${token.value}">${children()}</span>`;
      case "URL":
      case "EMAIL":
        return `<a href="${escapeHtml(token.href)}">${children()}</a>`;
      case "IMG":
        return `<img src="${escapeHtml(token.href)}" alt="">`;
      case "MEDIA":
        return token.html;
      case "ICODE":
        return `<code>${token.tokens ? children() : escapeHtml(token.text)}</code>`;
      case "PLAIN":
        return escapeHtml(token.text).replace(/\n/g, "<br>");
      case "ATTACH":
        return `<span class="bb-attach" data-attach-id="${token.id}" data-attach-size="${token.size}">${token.id}</span>`;
      case "TEXT":
        // A link, e-mail or spoiler inside a link: only its text remains.
        return children();
      case "ISPOILER":
        return (
          renderSpoilerPlaceholder(this.parser, true, null, children) ??
          `<span class="spoiler">${children()}</span>`
        );
    }
    return "";
  },
};

/** Text between the tags of rich code: shown as typed. */
export const bbTextExtension: TokenizerAndRendererExtension = {
  name: "sermoBbText",
  level: "inline",
  renderer(token) {
    return escapeHtml(token.text);
  },
};

type Head = {
  name: string;
  option: string | undefined;
  lead: number;
  inner: string;
  end: number;
};

function blockOptionAllowed(name: string, option: string | undefined): boolean {
  switch (name) {
    case "QUOTE":
    case "SPOILER":
      return option === undefined || option.length <= 300;
    case "CODE":
      return option === undefined || /^[A-Za-z0-9+#._-]{1,20}$/.test(option);
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

function blockHead(src: string, at: number): Head | undefined {
  OPEN_AT.lastIndex = at;
  const open = OPEN_AT.exec(src);
  if (!open) return;
  const name = open[1]!.toUpperCase();
  if (!BLOCK_TAGS.has(name)) return;
  const option = normalizeOption(open[2]);
  if (!blockOptionAllowed(name, option)) return;
  const bodyStart = at + open[0].length;
  const close = findClose(src, bodyStart, name, option);
  if (!close) return;
  const inner = src.slice(bodyStart, close.start);
  // A PLAIN without a blank line is inline; with one, only a block keeps the paragraphs together.
  if (name === "PLAIN" && !inner.includes("\n\n")) return;
  // A table without a row is not one; claiming it would make the lexer retry at every tag.
  if (name === "TABLE" && !(/\[TR\]/i.test(inner) && /\[\/TR\]/i.test(inner))) return;
  return { name, option, lead: at, inner, end: close.end };
}

/**
 * The blocks of a tag's content. A single paragraph is returned as its inline tokens (`tight`); in a
 * list item (`item`) the text before a nested list also stays inline (`lead`, then `rest`).
 */
type Part = { tokens: Token[]; tight: boolean; lead?: Token[]; rest?: Token[] };
function body(lexer: Lexer, text: string, item = false): Part {
  const tokens = lexer.blockTokens(text.trim()) as Token[];
  const first = tokens[0];
  if (first?.type !== "paragraph") return { tokens, tight: false };
  if (tokens.length === 1) return { tokens: first.tokens as Token[], tight: true };
  const rest = tokens.slice(1);
  return item && rest.every((token) => token.type !== "paragraph")
    ? { tokens, tight: false, lead: first.tokens as Token[], rest }
    : { tokens, tight: false };
}

function splitItems(inner: string): string[] {
  const items: string[] = [];
  const tags = new RegExp(TAG_SOURCE, "gi");
  let level = 0;
  let from = 0;
  for (let match = tags.exec(inner); match; match = tags.exec(inner)) {
    spend();
    const tag = match[2]!.toUpperCase();
    if (tag === "LIST") level += match[1] ? -1 : 1;
    else if (tag === "*" && !match[1] && level === 0) {
      items.push(inner.slice(from, match.index));
      from = tags.lastIndex;
    } else if (!match[1] && isLiteral(tag, normalizeOption(match[3]))) {
      const skip = new RegExp(String.raw`\[\/${tag}\]`, "gi");
      skip.lastIndex = tags.lastIndex;
      const found = skip.exec(inner);
      if (found) tags.lastIndex = found.index + found[0].length;
    }
  }
  items.push(inner.slice(from));
  // Text before the first [*] is dropped when blank and is an item of its own otherwise.
  return items.filter((item, index) => index > 0 || item.trim() !== "");
}

function sequence(inner: string, parent: RegExp, name: (match: RegExpExecArray) => string) {
  const parts: { name: string; inner: string }[] = [];
  const opens = new RegExp(parent.source, "gi");
  for (let match = opens.exec(inner); match; match = opens.exec(inner)) {
    spend();
    const tag = name(match);
    const close = findClose(inner, opens.lastIndex, tag);
    if (!close) break;
    parts.push({ name: tag, inner: inner.slice(opens.lastIndex, close.start) });
    opens.lastIndex = close.end;
  }
  return parts;
}

/** Longer code is shown as a plain block: highlighting cost grows with its length. */
const HIGHLIGHT_LIMIT = 2_000;

type CodePart =
  | { kind: "rich"; tokens: Token[] }
  | { kind: "plain"; text: string }
  | { kind: "language"; name: string; id?: string; html?: string; text?: string };

function codeBlock(head: Head): CodePart {
  const content = head.inner.replace(/^\n+|\n+$/g, "");
  const option = head.option?.toLowerCase();
  if (option === "rich") return { kind: "rich", tokens: richTokens(content) };
  if (option === undefined) return { kind: "plain", text: content };
  const highlighted = content.length <= HIGHLIGHT_LIMIT ? highlightCode(content, option) : null;
  return highlighted
    ? { kind: "language", name: highlighted.name, id: highlighted.id, html: highlighted.html }
    : { kind: "language", name: head.option ?? option, text: content };
}

export const bbBlockExtension: TokenizerAndRendererExtension = {
  name: "sermoBbBlock",
  level: "block",
  start(src) {
    BLOCK_CANDIDATE.lastIndex = 0;
    for (let match = BLOCK_CANDIDATE.exec(src); match; match = BLOCK_CANDIDATE.exec(src)) {
      spend();
      if (blockHead(src, match.index)) return match.index;
    }
    return -1;
  },
  tokenizer(src) {
    const lexer = this.lexer;
    const head = blockHead(src, / {0,3}/.exec(src)![0].length);
    if (!head) return;
    const rest = /^[ \t]*(?:\n|$)/.exec(src.slice(head.end))?.[0] ?? "";
    const raw = src.slice(0, head.end) + rest;
    const base = { type: "sermoBbBlock", raw, tag: head.name };
    const blocks = (kind: "quote" | "spoiler" | null = null) =>
      nest(kind, () => body(lexer, head.inner));
    switch (head.name) {
      case "LEFT":
      case "CENTER":
      case "RIGHT": {
        return { ...base, ...blocks() };
      }
      case "INDENT": {
        return { ...base, level: Number(head.option ?? 1), ...blocks() };
      }
      case "QUOTE": {
        const content = blocks("quote");
        const name = head.option?.replace(/,\s*post:\s*\d+(?:,\s*member:\s*\d+)?$/i, "");
        return { ...base, author: name || null, ...content };
      }
      case "SPOILER": {
        const content = blocks("spoiler");
        return { ...base, title: head.option || null, ...content };
      }
      case "HEADING":
        return {
          ...base,
          level: Number(head.option),
          tokens: nest(null, () => lexer.inlineTokens(head.inner.trim()) as Token[]),
        };
      case "PLAIN":
        return { ...base, text: head.inner.replace(/^\n+|\n+$/g, "") };
      case "CODE":
        return { ...base, code: codeBlock(head) };
      case "LIST": {
        const items = nest(null, () =>
          splitItems(head.inner).map((item) => body(lexer, item, true)),
        );
        return {
          ...base,
          ordered: head.option === "1",
          items,
          tokens: items.flatMap((item) => item.tokens),
        };
      }
      case "TABLE": {
        const rows = nest(null, () =>
          sequence(head.inner, /\[TR\]/, () => "TR").map((row) =>
            sequence(row.inner, /\[(TH|TD)\]/, (match) => match[1]!.toUpperCase()).map((cell) => ({
              header: cell.name === "TH",
              ...body(lexer, cell.inner),
            })),
          ),
        );
        if (!rows.length) return;
        return { ...base, rows, tokens: rows.flat().flatMap((cell) => cell.tokens) };
      }
    }
  },
  renderer(token) {
    const parse = (part: Part) =>
      part.lead
        ? this.parser.parseInline(part.lead) + this.parser.parse(part.rest ?? [])
        : part.tight
          ? this.parser.parseInline(part.tokens)
          : this.parser.parse(part.tokens);
    const content = () => parse(token as unknown as Part);
    switch (token.tag) {
      case "LEFT":
      case "CENTER":
      case "RIGHT":
        return `<div class="bb-${token.tag.toLowerCase()}">${content()}</div>`;
      case "INDENT":
        return `<div class="bb-indent bb-indent-${token.level}">${content()}</div>`;
      case "QUOTE": {
        const author = token.author
          ? `<cite class="bb-quote-author">${escapeHtml(token.author)}</cite>`
          : "";
        return `<blockquote class="bb-quote">${author}${content()}</blockquote>`;
      }
      case "SPOILER": {
        const placeholder = renderSpoilerPlaceholder(this.parser, false, token.title, content);
        if (placeholder) return placeholder;
        const title = token.title
          ? `<summary class="bb-spoiler-summary bb-has-title">${escapeHtml(token.title)}</summary>`
          : `<summary class="bb-spoiler-summary"></summary>`;
        return `<details class="spoiler">${title}${content()}</details>`;
      }
      case "HEADING":
        return `<h${token.level}>${this.parser.parseInline(token.tokens ?? [])}</h${token.level}>`;
      case "PLAIN":
        return `<div class="bb-plain">${escapeHtml(token.text).replace(/\n/g, "<br>")}</div>`;
      case "CODE":
        return codeHtml(this.parser, token.code);
      case "LIST": {
        const tag = token.ordered ? "ol" : "ul";
        const items = (token.items as Part[]).map((item) => `<li>${parse(item)}</li>`).join("");
        return `<${tag}>${items}</${tag}>`;
      }
      case "TABLE": {
        const rows = (token.rows as (Part & { header: boolean })[][])
          .map((row) => {
            const cells = row
              .map((cell) => {
                const tag = cell.header ? "th" : "td";
                return `<${tag}>${parse(cell)}</${tag}>`;
              })
              .join("");
            return `<tr>${cells}</tr>`;
          })
          .join("");
        return `<table class="bb-table"><tbody>${rows}</tbody></table>`;
      }
    }
    return "";
  },
};

function codeHtml(parser: Parser, code: CodePart): string {
  let header: string;
  let pre: string;
  if (code.kind === "rich") {
    header = `<div class="bb-code-header bb-code-rich"></div>`;
    pre = `<pre><code>${parser.parseInline(code.tokens ?? [])}</code></pre>`;
  } else if (code.kind === "plain") {
    header = `<div class="bb-code-header"></div>`;
    pre = `<pre><code>${escapeHtml(code.text)}</code></pre>`;
  } else {
    header = `<div class="bb-code-header bb-code-named"><span class="bb-code-lang">${escapeHtml(code.name)}</span></div>`;
    pre = code.html
      ? `<pre class="hljs language-${code.id}"><code>${code.html}</code></pre>`
      : `<pre><code>${escapeHtml(code.text ?? "")}</code></pre>`;
  }
  return `<div class="bb-code">${header}${pre}</div>`;
}

/** Whether a source may hold BB code at all. */
export function mayHoldBbCode(source: string): boolean {
  return source.includes("[");
}

/** The kind of container a BB token is, for the nesting limits. */
export function bbContainerKind(token: Token): "quote" | "spoiler" | null {
  if (token.type === "sermoBbBlock")
    return token.tag === "QUOTE" ? "quote" : token.tag === "SPOILER" ? "spoiler" : null;
  return token.type === "sermoBbInline" && token.tag === "ISPOILER" ? "spoiler" : null;
}

const SPOILER_OPEN = /\[(ISPOILER|SPOILER)(?:=("[^"\]\n]{0,200}"|[^\]\n"]{0,200}))?\]/gi;
const ANY_TAG = new RegExp(
  String.raw`\[\/?(?:${[...INLINE_TAGS, ...BLOCK_TAGS, "TR", "TH", "TD", String.raw`\*`].join("|")})(?:=[^\]\n]{0,200})?\]`,
  "gi",
);
const SPOILER_MARK = "\u0001";

/**
 * Plain-text paths that work from the source (excerpts, search snippets) show `[spoiler]` for BB
 * code spoilers and drop the other tags. Spoilers are found with the same matching the renderer
 * uses, so the text it hides is the text hidden here.
 */
export function maskBbCode(source: string, truncated = false): string {
  if (!source.includes("[")) return source;
  resetBbCode();
  let masked = "";
  let from = 0;
  let open: RegExpExecArray | null = null;
  SPOILER_OPEN.lastIndex = 0;
  try {
    for (open = SPOILER_OPEN.exec(source); open; open = SPOILER_OPEN.exec(source)) {
      const close = findClose(source, SPOILER_OPEN.lastIndex, open[1]!.toUpperCase());
      if (!close) {
        if (!truncated) continue;
        // The text was cut: a spoiler left open may have ended past the cut, so it hides the rest.
        masked += source.slice(from, open.index) + SPOILER_MARK;
        from = source.length;
        break;
      }
      masked += source.slice(from, open.index) + SPOILER_MARK;
      from = SPOILER_OPEN.lastIndex = close.end;
    }
    masked += source.slice(from);
  } catch {
    // Too complex to match: everything from the first spoiler tag on is hidden.
    masked = (open ? source.slice(0, open.index) : masked) + SPOILER_MARK;
  }
  return masked.replace(ANY_TAG, "");
}

/** The mark `maskBbCode` leaves where a spoiler was; callers turn it into `[spoiler]`. */
export const BB_SPOILER_MARK = SPOILER_MARK;
