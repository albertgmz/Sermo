import { $createCodeNode, $isCodeNode } from "@lexical/code";
import { $createLinkNode, $toggleLink } from "@lexical/link";
import {
  $isListItemNode,
  $isListNode,
  type ListItemNode,
  type ListNode,
} from "@lexical/list";
import {
  $createHeadingNode,
  $createQuoteNode,
  $isHeadingNode,
  $isQuoteNode,
  type QuoteNode,
} from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $findMatchingParent,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isLineBreakNode,
  $isParagraphNode,
  $isRangeSelection,
  $isRootNode,
  $isTextNode,
  COMMAND_PRIORITY_LOW,
  type ElementNode,
  IS_APPLE,
  KEY_DOWN_COMMAND,
  type LexicalEditor,
  type LexicalNode,
  type PointType,
  type TextNode,
} from "lexical";
import { withoutAttachTag } from "@/components/forum/composer-insert";
import { $allImages } from "@/components/forum/image-node";

export type BlockKind =
  | "paragraph"
  | "heading"
  | "quote"
  | "code"
  | "bullet"
  | "number";

// Makes the selected blocks a heading, a quote or a code block, or plain paragraphs again when
// they already are one (`current` is the block the caret is in).
export function $setBlock(
  current: BlockKind,
  block: "heading" | "quote" | "code",
) {
  const selection = $getSelection();
  if (current === block) {
    $setBlocksType(selection, () => $createParagraphNode());
  } else if (block === "heading") {
    $setBlocksType(selection, () => $createHeadingNode("h2"));
  } else if (block === "code") {
    $setBlocksType(selection, () => $createCodeNode());
  } else {
    $setBlocksType(selection, () => $createQuoteNode());
  }
}

// `text` with the "@" and what follows it, up to the caret, replaced by the mention. A space goes
// after it unless the text already goes on with one. The caret ends after the mention.
export function mentionInText(text: string, caret: number, mention: string) {
  const start = text.slice(0, caret).lastIndexOf("@");
  if (start < 0) return { text, caret };
  const next = text[caret];
  const space = next === undefined || !/\s/.test(next) ? " " : "";
  const inserted = `${mention}${space}`;
  return {
    text: text.slice(0, start) + inserted + text.slice(caret),
    caret: start + mention.length + space.length,
  };
}

// Replaces the "@" and what follows it, up to the caret, with the mention. A space goes after it
// unless the text already goes on with one (`mentionInText` does the same on plain text).
export function $insertMention(mention: string) {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return;
  const node = selection.anchor.getNode();
  if (!$isTextNode(node)) return;
  const offset = selection.anchor.offset;
  const text = node.getTextContent();
  const start = text.slice(0, offset).lastIndexOf("@");
  if (start < 0) return;
  const next = text[offset];
  const space = next === undefined || !/\s/.test(next) ? " " : "";
  node.spliceText(start, offset - start, `${mention}${space}`, true);
}

// Makes the selected text a link. With nothing selected there is no text to link, so the link is
// put in at the caret with its address as its text, and the caret goes after it.
export function $applyLink(url: string) {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return;
  if (!selection.isCollapsed()) {
    $toggleLink(url);
    return;
  }
  const link = $createLinkNode(url);
  link.append($createTextNode(url));
  selection.insertNodes([link]);
  link.selectNext(0, 0);
}

// Puts `text` in at the caret, over the selection if there is one. An editor that never had the
// focus has no selection yet: the text goes at its end.
export function $insertText(text: string) {
  let selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    $getRoot().selectEnd();
    selection = $getSelection();
  }
  if ($isRangeSelection(selection)) selection.insertText(text);
}

// Puts `open` before the selection and `close` after it, leaving what is between as it is (its
// formatting stays). With nothing selected the pair goes in at the caret, which stays between.
export function $wrapSelection(open: string, close: string) {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return;
  if (selection.isCollapsed()) {
    selection.insertText(open + close);
    const { key, offset, type } = selection.anchor;
    const inside = offset - close.length;
    selection.anchor.set(key, inside, type);
    selection.focus.set(key, inside, type);
    return;
  }
  const [first, last] = selection.isBackward()
    ? [selection.focus, selection.anchor]
    : [selection.anchor, selection.focus];
  // Read before anything changes: the points of the live selection move with each insertion.
  const start = { key: first.key, offset: first.offset, type: first.type };
  const end = { key: last.key, offset: last.offset, type: last.type };
  const at = (point: typeof start) => {
    const caret = $createRangeSelection();
    caret.anchor.set(point.key, point.offset, point.type);
    caret.focus.set(point.key, point.offset, point.type);
    return caret;
  };
  // The end first, so the start's offset is still right when the opening goes in.
  at(end).insertText(close);
  at(start).insertText(open);
}

// Takes the tags that place attachment `id` out of the text, and its pictures.
export function $removeAttachTags(id: number) {
  for (const image of $allImages()) if (image.getId() === id) image.remove();
  for (const node of $getRoot().getAllTextNodes()) {
    // Code shows a tag as text and is not a place for an attachment: it stays as written.
    if ($isCodeNode(node.getTopLevelElement()) || node.hasFormat("code"))
      continue;
    const text = node.getTextContent();
    const kept = withoutAttachTag(text, id);
    if (kept !== text) node.setTextContent(kept);
  }
}

// The tags that only format or lay out their text: what Remove formatting takes off. The others
// (links, mentions, attachments, media, spoilers, code, tables, and a quote with an attribution,
// which names the post it quotes) carry content and stay.
const FORMATTING_TAG =
  /\[(B|I|U|S|COLOR|FONT|SIZE|LEFT|CENTER|RIGHT|INDENT|ICODE|HEADING|QUOTE)(?:=[^\]\n]*)?\]([\s\S]*?)\[\/\1\]/gi;
const LIST_TAG = /\[LIST(?:=[^\]\n]*)?\]([\s\S]*?)\[\/LIST\]/gi;
// Stands for the start of a list item in text that is on its way to become separate lines.
const ITEM_BREAK = "\u0001";

function withoutFormattingTags(text: string) {
  const strip = (from: string): string =>
    from
      .replace(LIST_TAG, (_, items: string) =>
        items.replace(/^\s*\[\*\]\s*/, "").replace(/\s*\[\*\]\s*/g, ITEM_BREAK),
      )
      .replace(FORMATTING_TAG, (whole, name: string, inner: string): string => {
        if (!/^\[QUOTE=/i.test(whole)) return inner;
        // A quote with an attribution keeps its tags (and the post it names), not its formatting.
        const tags = name.length + 3;
        return (
          whole.slice(0, whole.length - inner.length - tags) +
          strip(inner) +
          whole.slice(whole.length - tags)
        );
      });
  let out = text;
  for (let next = strip(out); next !== out; ) {
    out = next;
    next = strip(out);
  }
  return out;
}

// The items of a list in reading order, those of nested lists included.
function listItemsOf(list: ListNode): ListItemNode[] {
  return list.getChildren().flatMap((child) => {
    if (!$isListItemNode(child)) return [];
    const inner = child.getFirstChild();
    return $isListNode(inner) ? listItemsOf(inner) : [child];
  });
}

// Takes the lines of a quote that `touched` says were selected out of it, as paragraphs. The lines
// before and after stay in a quote each (with the quote's alignment and indent). Lines are what the
// line breaks in the quote separate.
function $unquoteLines(
  quote: QuoteNode,
  touched: (node: LexicalNode) => boolean,
) {
  const children = quote.getChildren();
  const lines: LexicalNode[][] = [[]];
  const breaks: LexicalNode[] = [];
  for (const child of children) {
    if ($isLineBreakNode(child)) {
      breaks.push(child);
      lines.push([]);
    } else {
      lines[lines.length - 1]?.push(child);
    }
  }
  // A line with nothing in it is selected when the selection runs through the break after it.
  const picked = lines.map((line, index) => {
    if (line.length) return line.some(touched);
    if (!breaks.length) return touched(quote);
    const next = breaks[index] ?? breaks[index - 1];
    return next ? touched(next) : false;
  });
  let after: ElementNode = quote;
  for (let from = 0; from < lines.length; ) {
    let to = from;
    while (to + 1 < lines.length && picked[to + 1] === picked[from]) to++;
    const group = picked[from]
      ? $createParagraphNode()
      : $createQuoteNode()
          .setFormat(quote.getFormatType())
          .setIndent(quote.getIndent());
    for (let line = from; line <= to; line++) {
      if (line > from) group.append($createLineBreakNode());
      group.append(...(lines[line] ?? []));
    }
    after.insertAfter(group);
    after = group;
    from = to + 1;
  }
  quote.remove();
}

// A heading, quote or list becomes plain paragraphs; a paragraph loses its alignment and indent.
// Code blocks and anything else stay as they are. `touched` is left out to take the whole block
// (nothing selected); otherwise only the selected items of a list and lines of a quote change, and
// the rest stay in a list or quote of their own.
function $plainBlock(
  block: ElementNode,
  touched?: (node: LexicalNode) => boolean,
) {
  if ($isHeadingNode(block)) {
    block.replace($createParagraphNode(), true);
  } else if ($isQuoteNode(block)) {
    $unquoteLines(block, touched ?? (() => true));
  } else if ($isListNode(block)) {
    // Replacing an item moves it out of any nested list and splits the list around it.
    const made: ElementNode[] = [];
    for (const item of listItemsOf(block)) {
      if (!touched || touched(item)) {
        made.push(item.replace($createParagraphNode(), true));
      }
    }
    // The lists left take their first item's place: an item that is now first must not be a bare
    // nested list (it would export indented).
    const lists = [
      block,
      ...made.map((paragraph) => paragraph.getNextSibling()),
    ];
    for (const list of lists) {
      if (!$isListNode(list) || !list.isAttached()) continue;
      for (let first = list.getFirstChild(); $isListItemNode(first); ) {
        const inner = first.getFirstChild();
        if (!$isListNode(inner)) break;
        for (const item of inner.getChildren()) first.insertBefore(item);
        first.remove();
        first = list.getFirstChild();
      }
      // BB code numbers a list from 1 only, so each part starts there.
      if (list.getListType() === "number") list.setStart(1);
    }
  } else if ($isParagraphNode(block)) {
    if (block.getFormatType()) block.setFormat("");
    if (block.getIndent()) block.setIndent(0);
  }
}

// What a selection's end is in: a list item, else the top-level block.
function $unitOf(node: LexicalNode) {
  const unit = $findMatchingParent(
    node,
    (parent) => $isListItemNode(parent) || $isRootNode(parent.getParent()),
  );
  return $isElementNode(unit) ? unit : null;
}

// Whether the point is at the very start or end of `unit`. An empty element counts as all of it.
function $isAtEdge(point: PointType, unit: ElementNode, edge: "start" | "end") {
  let node: LexicalNode | null = point.getNode();
  const size = $isElementNode(node)
    ? node.getChildrenSize()
    : $isTextNode(node)
      ? node.getTextContentSize()
      : -1;
  if (size < 1 || point.offset !== (edge === "start" ? 0 : size)) return false;
  while (node && !node.is(unit)) {
    if (edge === "start" ? node.getPreviousSibling() : node.getNextSibling()) {
      return false;
    }
    node = node.getParent();
  }
  return node !== null;
}

// Takes the formatting off the selected text, or off the whole message when nothing is selected:
// bold, italic, underline, strikethrough, inline code, sub- and superscript, any style, headings,
// quotes, lists and alignment, and the formatting BB code tags typed as text. Links, mentions,
// attachments, spoilers and code blocks stay. A selection takes only the list items and quote lines
// it touches out of their list or quote. Call it inside one `editor.update` so that one Undo
// puts everything back.
export function $removeFormatting() {
  const selection = $getSelection();
  const range =
    $isRangeSelection(selection) && !selection.isCollapsed() ? selection : null;
  // A selection that ends at the very start of the next block (a triple click does) holds none of
  // that block, nor does one that starts at the very end of a block: they are left alone, as
  // `$setBlocksType` does.
  const skipped: ElementNode[] = [];
  if (range) {
    const [first, last] = range.isBackward()
      ? [range.focus, range.anchor]
      : [range.anchor, range.focus];
    const firstUnit = $unitOf(first.getNode());
    const lastUnit = $unitOf(last.getNode());
    if (firstUnit && lastUnit && !firstUnit.is(lastUnit)) {
      if ($isAtEdge(last, lastUnit, "start")) skipped.push(lastUnit);
      if ($isAtEdge(first, firstUnit, "end")) skipped.push(firstUnit);
    }
  }
  // Split at the ends of the selection first, so that only the selected text is touched.
  const root = $getRoot();
  const nodes = (range ? range.extract() : root.getAllTextNodes()).filter(
    (node) => !skipped.some((unit) => unit.is(node) || unit.isParentOf(node)),
  );
  const selected = new Set(nodes.map((node) => node.getKey()));
  const touched = (node: LexicalNode): boolean =>
    selected.has(node.getKey()) ||
    ($isElementNode(node) && node.getChildren().some(touched));
  const texts = nodes.filter($isTextNode);
  const blocks = new Set<ElementNode>(
    range
      ? nodes.map((node) => node.getTopLevelElement()).filter($isElementNode)
      : root.getChildren().filter($isElementNode),
  );

  // Text in a code block is code, not text to clean. What was inline code is plain text now, but
  // its tags are shown as written.
  const cleaned: TextNode[] = [];
  const written = new Set<string>();
  for (const node of texts) {
    if ($isCodeNode(node.getTopLevelElement())) continue;
    if (node.hasFormat("code")) written.add(node.getKey());
    node.setFormat(0);
    if (node.getStyle()) node.setStyle("");
    cleaned.push(node);
  }
  // A tag can be split between two runs of text that differed in format; join those that now match.
  const alive: TextNode[] = [];
  for (const node of cleaned) {
    const before = alive[alive.length - 1];
    if (
      before?.isAttached() &&
      before.getNextSibling()?.is(node) &&
      before.isSimpleText() &&
      node.isSimpleText() &&
      written.has(before.getKey()) === written.has(node.getKey())
    ) {
      before.getLatest().mergeWithSibling(node.getLatest());
    } else {
      alive.push(node);
    }
  }
  for (const node of alive) {
    if (written.has(node.getKey())) continue;
    const text = node.getTextContent();
    const kept = withoutFormattingTags(text);
    if (kept === text) continue;
    if (kept) {
      // Where a list item began there is now a line break.
      const [first = "", ...items] = kept.split(ITEM_BREAK);
      node.setTextContent(first);
      let last: LexicalNode = node;
      for (const item of items) {
        const line = $createLineBreakNode();
        last.insertAfter(line);
        last = line;
        if (item) {
          const text = $createTextNode(item);
          line.insertAfter(text);
          last = text;
        }
      }
      for (const point of $isRangeSelection(selection)
        ? [selection.anchor, selection.focus]
        : []) {
        if (point.key === node.getKey() && point.offset > first.length) {
          point.set(point.key, first.length, point.type);
        }
      }
    } else {
      node.remove();
    }
  }
  for (const block of blocks) {
    if (block.isAttached()) $plainBlock(block, range ? touched : undefined);
  }
  if ($isRangeSelection(selection)) {
    selection.setFormat(0);
    selection.setStyle("");
  }
}

// Ctrl+\ (Cmd+\ on a Mac as well) takes the formatting off. AltGr+\ on some layouts reports Alt
// too, and types a backslash instead.
export function registerRemoveFormattingShortcut(editor: LexicalEditor) {
  return editor.registerCommand(
    KEY_DOWN_COMMAND,
    (event) => {
      const modifier = event.ctrlKey || (IS_APPLE && event.metaKey);
      if (event.key !== "\\" || !modifier || event.shiftKey || event.altKey) {
        return false;
      }
      event.preventDefault();
      editor.update(() => $removeFormatting());
      return true;
    },
    COMMAND_PRIORITY_LOW,
  );
}
