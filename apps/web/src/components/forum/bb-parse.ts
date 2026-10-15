import {
  closerFinder,
  isCodeLanguage,
  isLinkAddress,
  isWebAddress,
  TAG_SOURCE,
} from "@/components/forum/bb-scan";

// BB code read into what the rich editor can hold. The editor shows bold, italic, underline,
// strikethrough, inline code, links, headings, quotes, lists and code blocks as formatting; every
// other tag (colour, size, alignment, spoilers, tables, media, attachments, quotes of a post...)
// and every tag that is unpaired or in the wrong place stays in the text as typed, so that
// writing it back gives the same source. Nothing is ever dropped.
//
// The reading follows the backend's (packages/core/src/bbcode): a closing tag pairs with the
// nearest open tag of its name and leaves the tags opened after it as text, an unclosed tag is
// text, the content of CODE, ICODE, PLAIN, IMG, MEDIA and ATTACH is not read, and a blank line
// ends a paragraph.

export type Mark = "bold" | "italic" | "underline" | "strikethrough" | "code";

export type Inline =
  | { t: "text"; text: string; marks: Mark[] }
  | { t: "br" }
  | { t: "link"; url: string; kids: Inline[] };

export type ListSpec = {
  t: "list";
  ordered: boolean;
  items: { kids: Inline[]; nested: ListSpec[] }[];
};

export type Block =
  | { t: "p" | "quote"; kids: Inline[] }
  | { t: "h"; level: 1 | 2 | 3; kids: Inline[] }
  | { t: "code"; text: string; language?: string }
  | ListSpec;

// What a tag, or the text between tags, is once paired.
type Tree =
  | { k: "text"; s: string }
  | { k: "icode"; s: string; raw: string }
  | { k: "code"; s: string; raw: string; language?: string }
  | { k: "link"; href: string; raw: string }
  | {
      k: "el";
      name: string;
      option?: string;
      kids: Tree[];
      open: string;
      close: string;
      // Holds a block (a heading, quote, list or code block) somewhere inside.
      holdsBlock: boolean;
    };

type El = Extract<Tree, { k: "el" }>;
type Frame = {
  name: string;
  option?: string;
  open: string;
  kids: Tree[];
};

// Deeper tags stay text, as the backend refuses a message nested deeper than this.
const MAX_DEPTH = 30;
const MARK_OF: Record<string, Mark> = {
  B: "bold",
  I: "italic",
  U: "underline",
  S: "strikethrough",
};
const BLOCKS = new Set(["HEADING", "QUOTE", "LIST"]);
// Whether a tree is, or holds, a block.
const isBlock = (kid: Tree): boolean =>
  kid.k === "code" ||
  (kid.k === "el" && (BLOCKS.has(kid.name) || kid.holdsBlock));
// Tags whose content is text up to the closer.
const RAW = new Set(["PLAIN", "IMG", "MEDIA", "ATTACH"]);
const RAW_WITHOUT_OPTION = new Set(["EMAIL", "USER"]);

function parseTree(source: string): Tree[] {
  const find = closerFinder(source);
  const root: Frame = { name: "", open: "", kids: [] };
  const stack: Frame[] = [root];
  const top = () => stack[stack.length - 1];
  const addText = (s: string) => {
    if (!s) return;
    const kids = top().kids;
    const last = kids[kids.length - 1];
    if (last?.k === "text") last.s += s;
    else kids.push({ k: "text", s });
  };
  const addAll = (kids: Tree[]) => {
    for (const kid of kids) {
      if (kid.k === "text") addText(kid.s);
      else top().kids.push(kid);
    }
  };
  const finish = (close: string): El => {
    const frame = stack.pop() as Frame;
    const el: El = {
      k: "el",
      name: frame.name,
      option: frame.option,
      kids: frame.kids,
      open: frame.open,
      close,
      holdsBlock: frame.kids.some(isBlock),
    };
    top().kids.push(el);
    return el;
  };
  const literalize = () => {
    const frame = stack.pop() as Frame;
    addText(frame.open);
    addAll(frame.kids);
  };

  const re = new RegExp(TAG_SOURCE, "g");
  let pos = 0;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    addText(source.slice(pos, m.index));
    const head = m[0];
    const end = m.index + head.length;
    pos = end;
    const closing = m[1] !== undefined;
    const name = m[2].toUpperCase();
    const option = (m[3] ?? m[4])?.trim();

    if (closing) {
      const at = stack.findLastIndex((frame) => frame.name === name);
      if (at < 1 || name === "*") {
        addText(head);
        continue;
      }
      // Tags opened after it that are still open are text, but the items of a list belong to it.
      while (stack.length - 1 > at) {
        if (top().name === "*" && stack[stack.length - 2].name === "LIST") {
          finish("");
        } else {
          literalize();
        }
      }
      finish(head);
      continue;
    }

    // Tags that read their content as text.
    const wantsCloser =
      name === "ICODE"
        ? option === undefined
        : name === "CODE"
          ? option === undefined || isCodeLanguage(option)
          : name === "URL"
            ? option === undefined
            : RAW.has(name) ||
              (RAW_WITHOUT_OPTION.has(name) && option === undefined);
    if (wantsCloser) {
      const closer = find(name, end);
      if (closer < 0) {
        addText(head);
        continue;
      }
      const closeEnd = closer + name.length + 3;
      const inner = source.slice(end, closer);
      const raw = source.slice(m.index, closeEnd);
      if (name === "CODE") {
        top().kids.push({ k: "code", s: inner, raw, language: option });
      } else if (name === "ICODE") {
        top().kids.push({ k: "icode", s: inner, raw });
      } else if (name === "URL") {
        const href = inner.trim();
        if (inner.length > 2100 || !isWebAddress(href)) {
          addText(head);
          continue;
        }
        top().kids.push({ k: "link", href, raw });
      } else {
        addText(raw);
      }
      pos = closeEnd;
      re.lastIndex = closeEnd;
      continue;
    }

    if (name === "*") {
      if (top().name === "*" && stack[stack.length - 2].name === "LIST") {
        finish("");
        stack.push({ name, open: head, kids: [] });
      } else if (top().name === "LIST") {
        stack.push({ name, open: head, kids: [] });
      } else {
        addText(head);
      }
      continue;
    }

    const supported =
      stack.length <= MAX_DEPTH &&
      (name in MARK_OF
        ? option === undefined
        : name === "URL"
          ? option !== undefined && isLinkAddress(option)
          : name === "HEADING"
            ? option !== undefined && /^[1-3]$/.test(option)
            : name === "LIST"
              ? option === undefined || option === "1"
              : name === "QUOTE" && option === undefined);
    if (supported) stack.push({ name, option, open: head, kids: [] });
    else addText(head);
  }
  addText(source.slice(pos));
  while (stack.length > 1) literalize();
  return root.kids;
}

// Where the blocks and the paragraph being written go; `blocks` is null where only inline content
// can be held (a heading, a quote, a link, a list item).
type Sink = { blocks: Block[] | null; line: Inline[] };

const BLANK_RUN = /\n[ \t\u00a0]*\n\s*/g;
const isBlank = (kid: Tree) => kid.k === "text" && !kid.s.trim();

function addInline(sink: Sink, text: string, marks: Mark[]) {
  if (text) sink.line.push({ t: "text", text, marks });
}

function addLines(sink: Sink, text: string, marks: Mark[]) {
  text.split("\n").forEach((line, index) => {
    if (index > 0) sink.line.push({ t: "br" });
    addInline(sink, line, marks);
  });
}

function trimLine(line: Inline[]): Inline[] {
  const out = line.slice();
  const edge = (end: "start" | "end") => {
    while (out.length) {
      const at = end === "start" ? 0 : out.length - 1;
      const item = out[at];
      if (item.t === "br") {
        out.splice(at, 1);
      } else if (item.t === "text") {
        const text =
          end === "start" ? item.text.trimStart() : item.text.trimEnd();
        if (text) {
          out[at] = { ...item, text };
          return;
        }
        out.splice(at, 1);
      } else {
        return;
      }
    }
  };
  edge("start");
  edge("end");
  return out;
}

function endParagraph(sink: Sink) {
  const kids = trimLine(sink.line);
  sink.line = [];
  if (kids.length) sink.blocks?.push({ t: "p", kids });
}

function addText(sink: Sink, text: string, marks: Mark[]) {
  if (!sink.blocks) {
    addLines(sink, text.replace(BLANK_RUN, "\n\n"), marks);
    return;
  }
  text.split(BLANK_RUN).forEach((part, index) => {
    if (index > 0) endParagraph(sink);
    addLines(sink, part, marks);
  });
}

function inlineOf(kids: Tree[], marks: Mark[], link: boolean): Inline[] {
  const sink: Sink = { blocks: null, line: [] };
  walk(kids, sink, marks, link);
  return trimLine(sink.line);
}

// A tag that cannot be shown as formatting: its tags stay in the text, its content is read as it
// would be without them.
function asText(el: El, sink: Sink, marks: Mark[], link: boolean) {
  addText(sink, el.open, marks);
  walk(el.kids, sink, marks, link);
  addText(sink, el.close, marks);
}

// A list the editor can hold: each item is text, then lists nested in it.
function listOf(el: El): ListSpec | null {
  const entries: Tree[][] = [];
  const lead: Tree[] = [];
  for (const kid of el.kids) {
    if (kid.k === "el" && kid.name === "*") entries.push(kid.kids);
    else lead.push(kid);
  }
  if (!lead.every(isBlank)) entries.unshift(lead);
  const items: ListSpec["items"] = [];
  for (const kids of entries) {
    const at = kids.findIndex((kid) => kid.k === "el" && kid.name === "LIST");
    const head = at < 0 ? kids : kids.slice(0, at);
    const after = at < 0 ? [] : kids.slice(at);
    if (head.some(isBlock)) return null;
    const nested: ListSpec[] = [];
    for (const kid of after) {
      if (isBlank(kid)) continue;
      const list = kid.k === "el" && kid.name === "LIST" ? listOf(kid) : null;
      if (!list) return null;
      nested.push(list);
    }
    items.push({ kids: inlineOf(head, [], false), nested });
  }
  return { t: "list", ordered: el.option === "1", items };
}

function walk(kids: Tree[], sink: Sink, marks: Mark[], link: boolean) {
  for (const kid of kids) {
    switch (kid.k) {
      case "text":
        addText(sink, kid.s, marks);
        break;
      case "icode":
        if (kid.s && !kid.s.includes("\n")) {
          addInline(
            sink,
            kid.s,
            marks.includes("code") ? marks : [...marks, "code"],
          );
        } else {
          addText(sink, kid.raw, marks);
        }
        break;
      case "link":
        if (link) {
          addText(sink, kid.raw, marks);
        } else {
          sink.line.push({
            t: "link",
            url: kid.href,
            kids: [{ t: "text", text: kid.href, marks }],
          });
        }
        break;
      case "code":
        if (sink.blocks) {
          endParagraph(sink);
          sink.blocks.push({
            t: "code",
            text: kid.s.replace(/^\n+|\n+$/g, ""),
            language: kid.language,
          });
        } else {
          addText(sink, kid.raw, marks);
        }
        break;
      case "el":
        element(kid, sink, marks, link);
        break;
    }
  }
}

function element(el: El, sink: Sink, marks: Mark[], link: boolean) {
  const mark = MARK_OF[el.name];
  if (mark) {
    if (el.holdsBlock) asText(el, sink, marks, link);
    else
      walk(
        el.kids,
        sink,
        marks.includes(mark) ? marks : [...marks, mark],
        link,
      );
    return;
  }
  if (el.name === "URL") {
    if (el.holdsBlock || link) {
      asText(el, sink, marks, link);
    } else {
      sink.line.push({
        t: "link",
        url: el.option as string,
        kids: inlineOf(el.kids, marks, true),
      });
    }
    return;
  }
  // The rest are blocks (and the items of a list that is shown as text).
  if (!sink.blocks || el.name === "*") {
    asText(el, sink, marks, link);
    return;
  }
  if (el.name === "LIST") {
    const list = listOf(el);
    if (list) {
      endParagraph(sink);
      sink.blocks.push(list);
    } else {
      asText(el, sink, marks, link);
    }
    return;
  }
  if (el.holdsBlock) {
    asText(el, sink, marks, link);
    return;
  }
  const kids = inlineOf(el.kids, [], false);
  endParagraph(sink);
  if (!kids.length) return;
  if (el.name === "HEADING") {
    sink.blocks.push({ t: "h", level: Number(el.option) as 1 | 2 | 3, kids });
  } else {
    sink.blocks.push({ t: "quote", kids });
  }
}

// The blocks BB code holds. With `literal` the text is taken as typed: no tag is read, only the
// blank lines and line breaks.
export function parseBb(source: string, literal = false): Block[] {
  const text = source.replace(/\r\n?/g, "\n");
  const blocks: Block[] = [];
  const sink: Sink = { blocks, line: [] };
  walk(literal ? [{ k: "text", s: text }] : parseTree(text), sink, [], false);
  endParagraph(sink);
  return blocks;
}
