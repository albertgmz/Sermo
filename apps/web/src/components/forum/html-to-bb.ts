import { isLinkAddress, isWebAddress } from "@/components/forum/bb-scan";

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
// Where a block begins or ends: a paragraph break, or just a line break.
const HARD = "";
const SOFT = "";

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
};

// The formatting a style attribute says (word processors write bold as a style of a span).
function styleOf(node: DomNode): Style {
  const css = (node.getAttribute?.("style") ?? "").toLowerCase();
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
  };
}

// Wraps the pieces of `inner` between block boundaries one by one, with the space around them left
// outside the tags.
function wrap(tag: string, inner: string): string {
  return inner
    .split(/([])/)
    .map((part, index) => {
      if (index % 2 === 1) return part;
      const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(part) as RegExpExecArray;
      return match[2]
        ? `${match[1]}[${tag}]${match[2]}[/${tag}]${match[3]}`
        : part;
    })
    .join("");
}

// Text that holds a closing tag would be read as BB code: it is wrapped so that it stays text.
function literal(text: string): string {
  if (!/\[\/[A-Za-z]{1,10}\]/.test(text)) return text;
  if (/\[\/plain\]/i.test(text)) return text;
  return `[PLAIN]${text}[/PLAIN]`;
}

type Context = { pre: boolean; link: boolean };

function kidsOf(node: DomNode, context: Context): string {
  let out = "";
  for (let i = 0; i < node.childNodes.length; i++) {
    out += walk(node.childNodes[i], context);
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
  raw.split(/([])/).forEach((part, index) => {
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

function walk(node: DomNode, context: Context): string {
  if (node.nodeType === TEXT) {
    const text = node.textContent ?? "";
    if (context.pre) return text;
    // The two private characters stand for block boundaries below: text has none of its own.
    return literal(
      text
        .replace(/[]/g, "")
        .replace(/ /g, " ")
        .replace(/[ \t\r\n\f]+/g, " "),
    );
  }
  if (node.nodeType !== ELEMENT) return "";
  const name = node.nodeName.toUpperCase();
  if (SKIP.has(name)) return "";
  if (name === "BR") return "\n";
  if (name === "HR") return HARD;
  if (name === "IMG") {
    const src = node.getAttribute?.("src") ?? "";
    return isWebAddress(src) ? `[IMG]${src}[/IMG]` : "";
  }
  if (name === "PRE") {
    const text = (node.textContent ?? "")
      .replace(/[]/g, "")
      .replace(/\r\n?/g, "\n")
      .replace(/^\n+|\n+$/g, "");
    if (!text.trim()) return "";
    if (/\[\/code\]/i.test(text)) return `${HARD}${text}${HARD}`;
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
  if (name === "A") {
    const href = (node.getAttribute?.("href") ?? "").trim();
    if (!context.link && isLinkAddress(href)) {
      const inner = format(
        node,
        kidsOf(node, { ...context, link: true }),
        name,
      );
      return inner.trim() ? `[URL=${href}]${inner}[/URL]` : inner;
    }
  }
  const inner = kidsOf(node, context);
  const block = PARAGRAPHS.has(name) ? HARD : LINES.has(name) ? SOFT : "";
  return `${block}${format(node, inner, name)}${block}`;
}

// The formatting of an element: its tag and its style.
function format(node: DomNode, inner: string, name: string): string {
  if (!inner.trim()) return inner;
  const style = styleOf(node);
  const bold = style.bold ?? BOLD.has(name);
  let out = inner;
  if (CODE.has(name)) {
    const text = node.textContent ?? "";
    if (text.trim() && !/[\n[]/.test(text)) out = `[ICODE]${text}[/ICODE]`;
  }
  // Inside out: bold ends up outermost, as the editor writes it.
  if (style.strike ?? STRIKE.has(name)) out = wrap("S", out);
  if (style.underline ?? UNDERLINE.has(name)) out = wrap("U", out);
  if (style.italic ?? ITALIC.has(name)) out = wrap("I", out);
  if (bold) out = wrap("B", out);
  return out;
}

export function htmlToBb(root: DomNode): string {
  return settle(kidsOf(root, { pre: false, link: false })).trim();
}
