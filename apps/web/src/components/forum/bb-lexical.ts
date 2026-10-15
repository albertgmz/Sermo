import {
  $createCodeNode,
  $isCodeNode,
  CodeHighlightNode,
  CodeNode,
} from "@lexical/code";
import { $createLinkNode, $isLinkNode, LinkNode } from "@lexical/link";
import {
  $createListItemNode,
  $createListNode,
  $isListItemNode,
  $isListNode,
  ListItemNode,
  ListNode,
} from "@lexical/list";
import {
  $createHeadingNode,
  $createQuoteNode,
  $isHeadingNode,
  $isQuoteNode,
  HeadingNode,
  QuoteNode,
} from "@lexical/rich-text";
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTabNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isLineBreakNode,
  $isRangeSelection,
  $isTextNode,
  type ElementNode,
  type LexicalNode,
} from "lexical";
import {
  type Block,
  type Inline,
  type ListSpec,
  type Mark,
  parseBb,
} from "@/components/forum/bb-parse";
import { isCodeLanguage, isLinkAddress } from "@/components/forum/bb-scan";

// The editor holds BB code as rich text and writes it back. `bb-parse.ts` says what is shown as
// formatting; this file builds the editor's nodes from that and writes the nodes as BB code.
// Whatever is not formatting is text in the editor and is written exactly as it is.

export const BB_NODES = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  LinkNode,
  CodeNode,
  CodeHighlightNode,
];

// ---- BB code to nodes ----

function inlineNodes(items: Inline[]): LexicalNode[] {
  return items.map((item) => {
    if (item.t === "br") return $createLineBreakNode();
    if (item.t === "link") {
      return $createLinkNode(item.url).append(...inlineNodes(item.kids));
    }
    const node = $createTextNode(item.text);
    for (const mark of item.marks) node.toggleFormat(mark);
    return node;
  });
}

function listNode(spec: ListSpec): ListNode {
  const list = $createListNode(spec.ordered ? "number" : "bullet");
  for (const item of spec.items) {
    list.append($createListItemNode().append(...inlineNodes(item.kids)));
    // A list inside an item is an item of its own that holds only that list.
    for (const nested of item.nested) {
      list.append($createListItemNode().append(listNode(nested)));
    }
  }
  return list;
}

function codeNode(text: string, language?: string) {
  const code = $createCodeNode(language);
  text.split("\n").forEach((line, index) => {
    if (index > 0) code.append($createLineBreakNode());
    line.split(/(\t)/).forEach((part) => {
      if (part === "\t") code.append($createTabNode());
      else if (part) code.append($createTextNode(part));
    });
  });
  return code;
}

function blockNode(block: Block): ElementNode {
  switch (block.t) {
    case "p":
      return $createParagraphNode().append(...inlineNodes(block.kids));
    case "h":
      return $createHeadingNode(`h${block.level}`).append(
        ...inlineNodes(block.kids),
      );
    case "quote":
      return $createQuoteNode().append(...inlineNodes(block.kids));
    case "code":
      return codeNode(block.text, block.language);
    case "list":
      return listNode(block);
  }
}

// Puts BB code in place of everything the editor holds.
export function $replaceWithBb(source: string) {
  const root = $getRoot().clear();
  const blocks = parseBb(source);
  root.append(
    ...(blocks.length ? blocks.map(blockNode) : [$createParagraphNode()]),
  );
}

// Adds BB code at the end, with the caret on a paragraph of its own below it.
export function $appendBb(source: string) {
  const root = $getRoot();
  const last = root.getLastChild();
  if (last && $isElementNode(last) && !last.getTextContentSize()) {
    last.remove();
  }
  root.append(...parseBb(source).map(blockNode));
  const below = $createParagraphNode();
  root.append(below);
  below.select();
}

// Puts BB code in at the caret, over the selection if there is one. With `literal` the text is
// taken as typed: no tag is read into formatting. In a code block everything is text, so it is
// `plain` (what the BB code was made from, when that is not it) that goes in, lines and all.
export function $insertBb(source: string, literal = false, plain = source) {
  // The space at the edges of what is put in belongs to it: it is not a document.
  const blocks = parseBb(source, literal, true);
  if (!blocks.length) return;
  let selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    $getRoot().selectEnd();
    selection = $getSelection();
  }
  if (!$isRangeSelection(selection)) return;
  if ($isCodeNode(selection.anchor.getNode().getTopLevelElement())) {
    selection.insertRawText(plain);
    return;
  }
  const [only] = blocks;
  selection.insertNodes(
    blocks.length === 1 && only.t === "p"
      ? inlineNodes(only.kids)
      : blocks.map(blockNode),
  );
}

// ---- nodes to BB code ----

const MARKS: [Mark, string][] = [
  ["bold", "B"],
  ["italic", "I"],
  ["underline", "U"],
  ["strikethrough", "S"],
  ["code", "ICODE"],
];

// The text of a run of nodes with its formatting as tags that nest properly: a tag is closed
// together with every tag opened after it, and opened again where its format goes on. Inline code
// is always the innermost, as nothing is read inside it.
// The tags a text node's format is written as, outermost first.
function tagsOf(node: LexicalNode | undefined): string[] {
  if (!node || !$isTextNode(node)) return [];
  const text = node.getTextContent();
  return MARKS.filter(
    ([mark]) =>
      node.hasFormat(mark) && !(mark === "code" && /\[\/icode\]/i.test(text)),
  ).map(([, tag]) => tag);
}

function inlineBb(parent: ElementNode): string {
  const kids = parent.getChildren();
  // What follows each node, past the line breaks and the space between words: a format goes on
  // over a break, or over a space, when it goes on in the text after it.
  const after: (LexicalNode | undefined)[] = [];
  let next: LexicalNode | undefined;
  for (let i = kids.length - 1; i >= 0; i--) {
    after[i] = next;
    const kid = kids[i];
    if (
      !$isLineBreakNode(kid) &&
      !($isTextNode(kid) && !kid.getTextContent().trim())
    ) {
      next = kid;
    }
  }
  let out = "";
  const open: string[] = [];
  const close = (to: number) => {
    while (open.length > to) out += `[/${open.pop()}]`;
  };
  // Closes the tags that do not go on in `want`.
  const keepOnly = (want: string[]) => {
    let keep = 0;
    while (keep < open.length && open[keep] === want[keep]) keep++;
    close(keep);
  };
  kids.forEach((node, index) => {
    if ($isLinkNode(node)) {
      close(0);
      const inner = inlineBb(node);
      const url = node.getURL();
      if (!isLinkAddress(url)) out += inner;
      // A link whose text is its address is written as an address: with www. the renderer adds
      // https:// itself.
      else if (
        /^https?:/i.test(url) &&
        (inner === url || inner === /^https:\/\/(www\..*)$/i.exec(url)?.[1])
      )
        out += `[URL]${inner}[/URL]`;
      else out += `[URL=${url}]${inner}[/URL]`;
    } else if ($isTextNode(node)) {
      const text = node.getTextContent();
      let want = tagsOf(node);
      if (!text.trim()) {
        // Space between words takes no format of its own: it only goes on in the formats that go
        // on after it (a format around nothing is nothing).
        const onward = tagsOf(after[index]);
        let keep = 0;
        while (keep < open.length && open[keep] === onward[keep]) keep++;
        want = open.slice(0, keep);
      }
      keepOnly(want);
      for (const tag of want.slice(open.length)) {
        out += `[${tag}]`;
        open.push(tag);
      }
      out += text;
    } else if ($isLineBreakNode(node)) {
      // Formats go on over a break unless inline code, which cannot hold one.
      keepOnly(tagsOf(after[index]));
      const code = open.indexOf("ICODE");
      if (code >= 0) close(code);
      out += "\n";
    } else if ($isListNode(node)) {
      close(0);
    } else if ($isElementNode(node)) {
      close(0);
      out += inlineBb(node);
    } else {
      close(0);
      out += node.getTextContent();
    }
  });
  close(0);
  return out;
}

function listBb(list: ListNode): string {
  const items: string[] = [];
  for (const item of list.getChildren()) {
    if (!$isListItemNode(item)) continue;
    const lists = item.getChildren().filter($isListNode).map(listBb);
    const text = inlineBb(item).trim();
    if (!text && lists.length) {
      // An item that holds only lists belongs to the item before it.
      if (items.length) items[items.length - 1] += `\n${lists.join("\n")}`;
      else items.push(lists.join("\n"));
    } else {
      items.push([text, ...lists].filter(Boolean).join("\n"));
    }
  }
  if (!items.some((item) => item.trim())) return "";
  const tag = list.getListType() === "number" ? "[LIST=1]" : "[LIST]";
  return `${tag}\n${items.map((item) => `[*]${item}`).join("\n")}\n[/LIST]`;
}

function codeBb(code: ElementNode): string {
  const text = code.getTextContent().replace(/^\n+|\n+$/g, "");
  if (!text.trim()) return "";
  // Code that holds the closing tag cannot be wrapped: it is written as lines of text.
  if (/\[\/code\]/i.test(text)) return text;
  const language = $isCodeNode(code) ? code.getLanguage() : undefined;
  const option = language && isCodeLanguage(language) ? `=${language}` : "";
  return `[CODE${option}]\n${text}\n[/CODE]`;
}

function blockBb(node: LexicalNode): string {
  if ($isHeadingNode(node)) {
    const level = Math.min(Number(node.getTag().slice(1)), 3);
    const text = inlineBb(node).trim();
    return text ? `[HEADING=${level}]${text}[/HEADING]` : "";
  }
  if ($isQuoteNode(node)) {
    const text = inlineBb(node).trim();
    return text ? `[QUOTE]${text}[/QUOTE]` : "";
  }
  if ($isListNode(node)) return listBb(node);
  if ($isCodeNode(node)) return codeBb(node);
  if ($isElementNode(node)) return inlineBb(node).trim();
  return node.getTextContent().trim();
}

// What the editor holds, as BB code: one paragraph or block after another with a blank line
// between, a line break as a line break.
export function $exportBb(): string {
  return $getRoot().getChildren().map(blockBb).filter(Boolean).join("\n\n");
}
