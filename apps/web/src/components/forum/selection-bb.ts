import { quoteOf } from "@/components/forum/bb-text";

// Quoting only the part of a post the member selected, as XenForo's "Quote" tooltip does. The
// pieces here read the page and build BB code; `selection-quote.tsx` draws the button.

const BODY = "[data-quote-id]";
// A quote inside the post: a selection that starts or ends in one is not offered (XenForo's).
const NESTED = ".bb-quote";

type Reference = "post" | "convMessage";

// The attributes that make the body of a post or message quotable by selection: what the quote's
// attribution needs. A post the viewer may not quote carries none.
export function quotable(
  reference: Reference,
  id: number,
  author: { id: number; username: string },
) {
  return {
    "data-quote-ref": reference,
    "data-quote-id": id,
    "data-quote-author": author.username,
    "data-quote-author-id": author.id,
  };
}

const elementOf = (node: Node) =>
  node.nodeType === 1 ? (node as Element) : node.parentElement;

// The body the whole selection lies in, or null: the selection must start and end in the same
// body (one post), and neither end may be inside a quote shown in it. A selection that ends at the
// very start of what follows the body in the same post (a triple click) still counts; the caller
// brings its end back to the body.
export function selectedBody(
  range: Pick<Range, "startContainer" | "endContainer" | "endOffset">,
) {
  const start = elementOf(range.startContainer);
  const end = elementOf(range.endContainer);
  const body = start?.closest(BODY);
  if (!body || !end || start?.closest(NESTED)) return null;
  const endBody = end.closest(BODY);
  if (endBody) return endBody === body && !end.closest(NESTED) ? body : null;
  const sameItem = end.closest("article") === body.closest("article");
  return range.endOffset === 0 && sameItem ? body : null;
}

// The attribution the body carries, around BB code `source`.
export function partialQuote(body: Element, source: string) {
  return quoteOf(
    Number(body.getAttribute("data-quote-id")),
    body.getAttribute("data-quote-author") ?? "",
    Number(body.getAttribute("data-quote-author-id")),
    source,
    body.getAttribute("data-quote-ref") === "convMessage"
      ? "convMessage"
      : "post",
  );
}

const FORMAT: Record<string, string> = {
  STRONG: "B",
  B: "B",
  EM: "I",
  I: "I",
  U: "U",
  DEL: "S",
  S: "S",
};
const BLOCK = new Set([
  "P",
  "DIV",
  "UL",
  "OL",
  "LI",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "TABLE",
  "TR",
  "DETAILS",
]);
// Words the page draws around the text, not part of it.
const DECORATION = new Set(["CITE", "SUMMARY", "BUTTON", "SCRIPT", "STYLE"]);

// The BB code of selected content, as far as XenForo keeps it: bold, italic, underline,
// strike-through, links, nested quotes and code; everything else is its text. Paragraphs are
// separated by a blank line.
export function bbOf(node: Node): string {
  return tidy(convert(node));
}

const tidy = (text: string) => text.replace(/\n{3,}/g, "\n\n").trim();

function convert(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? "";
  if (node.nodeType !== 1 && node.nodeType !== 11) return "";
  const element = node as Element;
  const name = node.nodeType === 1 ? element.nodeName : "";
  if (DECORATION.has(name)) return "";
  if (name === "BR") return "\n";
  if (name === "IMG") return element.getAttribute("alt") ?? "";
  if (name === "PRE") return `\n\n[CODE]${node.textContent ?? ""}[/CODE]\n\n`;
  const inner = Array.from(node.childNodes, convert).join("");
  const format = FORMAT[name];
  if (format) return inner.trim() ? `[${format}]${inner}[/${format}]` : inner;
  const href = name === "A" ? element.getAttribute("href") : null;
  if (href && /^https?:\/\//i.test(href) && inner.trim())
    return `[URL=${href}]${inner}[/URL]`;
  if (name === "BLOCKQUOTE") return `\n\n[QUOTE]${tidy(inner)}[/QUOTE]\n\n`;
  return BLOCK.has(name) ? `\n\n${inner}\n\n` : inner;
}
