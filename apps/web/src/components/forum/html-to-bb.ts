import { isWebAddress } from "@/components/forum/bb-scan";

// Rich text pasted from a web page or a word processor, as BB code: bold, italic, underline,
// strikethrough, inline code, links, lists, quotes, headings and code blocks, and a picture as
// [IMG] when its address is http(s). Everything else (tables, colours, fonts, sizes, other media)
// is its text. The walk needs only the parts of a DOM node declared here.

export type DomNode = {
  nodeType: number;
  nodeName: string;
  childNodes: ArrayLike<DomNode>;
  textContent: string | null;
  getAttribute?(name: string): string | null;
};

const TEXT = 3;
const ELEMENT = 1;
// Where a block begins or ends: a paragraph break, or just a line break. Two private characters
// stand for them in the text on its way; the text of a page has none of its own.
const HARD = String.fromCharCode(0xe001);
const SOFT = String.fromCharCode(0xe000);
const BOUNDARY = new RegExp(`([${SOFT}${HARD}])`);
const BOUNDARIES = new RegExp(`[${SOFT}${HARD}]`, "g");

const SKIP = new Set([
  "SCRIPT",
  "STYLE",
  "HEAD",
  "TITLE",
  "META",
  "LINK",
  "NOSCRIPT",
  "TEMPLATE",
  "SVG",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "VIDEO",
  "AUDIO",
  "CANVAS",
  "BUTTON",
  "SELECT",
  "TEXTAREA",
  "INPUT",
]);
const PARAGRAPHS = new Set(["P", "ADDRESS", "FIELDSET"]);
const LINES = new Set([
  "DIV",
  "SECTION",
  "ARTICLE",
  "HEADER",
  "FOOTER",
  "MAIN",
  "ASIDE",
  "NAV",
  "FIGURE",
  "FIGCAPTION",
  "TABLE",
  "TBODY",
  "THEAD",
  "TFOOT",
  "TR",
  "DETAILS",
  "SUMMARY",
  "DL",
  "DT",
  "DD",
  "FORM",
  "LI",
]);
const BOLD = new Set(["B", "STRONG"]);
const ITALIC = new Set(["I", "EM", "CITE", "DFN", "VAR"]);
const UNDERLINE = new Set(["U", "INS"]);
const STRIKE = new Set(["S", "STRIKE", "DEL"]);
const CODE = new Set(["CODE", "KBD", "SAMP", "TT"]);

type Style = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  pre?: boolean;
};

// The formatting a style attribute says (word processors write bold as a style of a span).
function styleOf(node: DomNode): Style {
  const css = (node.getAttribute?.("style") ?? "")
    .toLowerCase()
    .replace(/\s*!important/g, "");
  if (!css) return {};
  const value = (property: string) =>
    new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`).exec(css)?.[1]?.trim();
  const weight = value("font-weight");
  const decoration = `${value("text-decoration") ?? ""} ${value("text-decoration-line") ?? ""}`;
  const style = value("font-style");
  return {
    bold: weight ? /^(bold|bolder|[6-9]00)$/.test(weight) : undefined,
    italic: style ? /^(italic|oblique)/.test(style) : undefined,
    underline: decoration.includes("underline") || undefined,
    strike: decoration.includes("line-through") || undefined,
    pre: value("white-space") === "pre" || undefined,
  };
}

// The tags an element adds, outermost first. A link is drawn underlined by the page, which says
// nothing about the text.
function marksOf(node: DomNode, name: string): string[] {
  const style = styleOf(node);
  const marks: string[] = [];
  if (style.bold ?? BOLD.has(name)) marks.push("B");
  if (style.italic ?? ITALIC.has(name)) marks.push("I");
  if (name !== "A" && (style.underline ?? UNDERLINE.has(name))) marks.push("U");
  if (style.strike ?? STRIKE.has(name)) marks.push("S");
  return marks;
}

// Wraps the pieces of `inner` between block boundaries one by one, with the space around them left
// outside the tags.
function wrap(tag: string, inner: string): string {
  return inner
    .split(BOUNDARY)
    .map((part, index) => {
      if (index % 2 === 1) return part;
      const text = part.trim();
      // A block (a list, a heading, a quote, a code block) is not formatted text.
      if (!text || BLOCK_START.test(text)) return part;
      const start = part.length - part.trimStart().length;
      const end = part.length - part.trimEnd().length;
      return `${part.slice(0, start)}[${tag}]${text}[/${tag}]${part.slice(part.length - end)}`;
    })
    .join("");
}

const BLOCK_START = /^\[(?:LIST|HEADING|QUOTE|CODE)\b/;
// Text that holds a closing tag, or the opening of a tag that reads what follows it as text, or
// the start of a list item, would be read as BB code.
const TAG_TEXT =
  /\[\/[A-Za-z]{1,10}\]|\[(?:code|icode|plain|img|url|email|media|user|attach)\b[^\]\n]{0,200}\]|\[\*\]/i;

// The text after a node in the page, as far as a tag can reach (a tag can be split between
// elements: `<span>[/</span><span>B]</span>`).
const REACH = 200;
const SIBLINGS = 400;

// Such text is put between PLAIN tags to stay text. Between those tags a closing PLAIN tag cannot
// be written, so it is broken by an invisible character. A tag that begins in this text and ends
// in what follows it is found too; when what follows could not be read far enough (`null`), the
// text is kept as text all the same.
function literal(text: string, after: () => string | null): string {
  const open = text.lastIndexOf("[");
  const dangling =
    open >= 0 && text.length - open <= REACH && !text.includes("]", open);
  const rest = dangling ? after() : "";
  const found = rest === null ? null : TAG_TEXT.exec(text + rest);
  if (rest !== null && (!found || found.index >= text.length)) return text;
  return `[PLAIN]${text.replace(/\[\/(plain)\]/gi, "[/\u200b$1]")}[/PLAIN]`;
}

type Context = {
  link: boolean;
  marks: ReadonlySet<string>;
  // The text of what comes after the node being read; null when it was not read as far as a tag
  // can reach.
  after: () => string | null;
};

function kidsOf(node: DomNode, context: Context): string {
  let out = "";
  const kids = node.childNodes;
  for (let i = 0; i < kids.length; i++) {
    // What follows a child: its next siblings, then what follows its parent.
    const after = () => {
      let text = "";
      let k = i + 1;
      // As far as a tag can reach, in characters and in siblings (empty ones add no text).
      for (; k < kids.length && k - i <= SIBLINGS && text.length < REACH; k++) {
        text += (kids[k].textContent ?? "").slice(0, REACH);
      }
      if (text.length >= REACH) return text;
      if (k < kids.length) return null;
      const rest = context.after();
      return rest === null ? null : text + rest;
    };
    out += walk(kids[i], { ...context, after });
  }
  return out;
}

// Where block boundaries meet, one break: a blank line if either is a paragraph's, else a line
// break. Space around a boundary goes.
const SPACE = " \t\n";

function trimEnd(text: string) {
  let end = text.length;
  while (end > 0 && SPACE.includes(text[end - 1])) end--;
  return text.slice(0, end);
}

function trimStart(text: string) {
  let start = 0;
  while (start < text.length && SPACE.includes(text[start])) start++;
  return text.slice(start);
}

function settle(raw: string): string {
  const out: string[] = [];
  let hard = false;
  let soft = false;
  raw.split(BOUNDARY).forEach((part, index) => {
    if (index % 2 === 1) {
      hard ||= part === HARD;
      soft = true;
      if (out.length) out[out.length - 1] = trimEnd(out[out.length - 1]);
      return;
    }
    if (!soft) {
      out.push(part);
      return;
    }
    const rest = trimStart(part);
    if (!rest) return;
    out.push(hard ? "\n\n" : "\n", rest);
    hard = false;
    soft = false;
  });
  if (soft) out.push(hard ? "\n\n" : "\n");
  return out.join("");
}

function listOf(node: DomNode, context: Context): string {
  const ordered = node.nodeName === "OL";
  const items: string[] = [];
  for (let i = 0; i < node.childNodes.length; i++) {
    const item = node.childNodes[i];
    if (item.nodeName !== "LI") continue;
    const text = settle(kidsOf(item, context))
      .replace(/\n{2,}/g, "\n")
      .trim();
    if (text) items.push(`[*]${text}`);
  }
  if (!items.length) return "";
  return `${SOFT}[LIST${ordered ? "=1" : ""}]\n${items.join("\n")}\n[/LIST]${SOFT}`;
}

// The text of a code block as it was written: its spaces, its breaks, one line for each block in it.
function preText(node: DomNode): string {
  if (node.nodeType === TEXT) return node.textContent ?? "";
  if (node.nodeType !== ELEMENT) return "";
  const name = node.nodeName.toUpperCase();
  if (name === "BR") return "\n";
  if (SKIP.has(name)) return "";
  let out = "";
  for (let i = 0; i < node.childNodes.length; i++)
    out += preText(node.childNodes[i]);
  return PARAGRAPHS.has(name) || LINES.has(name) ? `${out}\n` : out;
}

function walk(node: DomNode, context: Context): string {
  if (node.nodeType === TEXT) {
    const text = (node.textContent ?? "").replace(BOUNDARIES, "");
    return literal(
      text.replace(/ /g, " ").replace(/[ \t\r\n\f]+/g, " "),
      context.after,
    );
  }
  if (node.nodeType !== ELEMENT) return "";
  const name = node.nodeName.toUpperCase();
  if (SKIP.has(name)) return "";
  if (name === "BR") return "\n";
  if (name === "HR") return HARD;
  if (name === "IMG") {
    const src = node.getAttribute?.("src") ?? "";
    if (isWebAddress(src)) return `[IMG]${src}[/IMG]`;
    // Any other picture is its alt text.
    const alt = (node.getAttribute?.("alt") ?? "")
      .replace(BOUNDARIES, "")
      .replace(/\s+/g, " ")
      .trim();
    return alt ? literal(alt, context.after) : "";
  }
  // A block whose style says its spaces and breaks are its text (code pasted from an editor is).
  if (
    name === "PRE" ||
    ((name === "DIV" || name === "P") && styleOf(node).pre)
  ) {
    const text = preText(node)
      .replace(BOUNDARIES, "")
      .replace(/\r\n?/g, "\n")
      .replace(/^\n+|\n+$/g, "");
    if (!text.trim()) return "";
    if (/\[\/code\]/i.test(text)) {
      return `${HARD}${literal(text, () => "")}${HARD}`;
    }
    return `${HARD}[CODE]\n${text}\n[/CODE]${HARD}`;
  }
  if (name === "UL" || name === "OL") return listOf(node, context);
  if (/^H[1-6]$/.test(name)) {
    const text = settle(kidsOf(node, context)).replace(/\n+/g, " ").trim();
    if (!text) return "";
    return `${HARD}[HEADING=${Math.min(Number(name[1]), 3)}]${text}[/HEADING]${HARD}`;
  }
  if (name === "BLOCKQUOTE") {
    const text = settle(kidsOf(node, context)).trim();
    return text ? `${HARD}[QUOTE]${text}[/QUOTE]${HARD}` : "";
  }
  if (name === "TD" || name === "TH") return `${kidsOf(node, context)} `;

  // Formatting this element adds and its ancestors have not: a tag is written once however many
  // elements say the same.
  const own = marksOf(node, name).filter((mark) => !context.marks.has(mark));
  const href = (node.getAttribute?.("href") ?? "").trim();
  const asLink = name === "A" && !context.link && isWebAddress(href);
  const inner = CODE.has(name)
    ? codeOf(node)
    : kidsOf(node, {
        ...context,
        link: context.link || asLink,
        marks: new Set([...context.marks, ...own]),
      });
  let out = inner;
  if (inner.trim()) {
    // Inside out: bold ends up outermost, as the editor writes it.
    for (const mark of [...own].reverse()) out = wrap(mark, out);
    if (asLink) out = `[URL=${href}]${out}[/URL]`;
  }
  const block = PARAGRAPHS.has(name) ? HARD : LINES.has(name) ? SOFT : "";
  return `${block}${out}${block}`;
}

// Inline code is its text on one line; code with a break or a bracket in it is just its text.
function codeOf(node: DomNode): string {
  const text = (node.textContent ?? "").replace(BOUNDARIES, "");
  if (!text.trim()) return "";
  return /[\n[]/.test(text)
    ? literal(text, () => "")
    : `[ICODE]${text}[/ICODE]`;
}

export function htmlToBb(root: DomNode): string {
  return settle(
    kidsOf(root, { link: false, marks: new Set(), after: () => "" }),
  ).trim();
}
