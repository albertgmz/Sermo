import { $isCodeNode } from "@lexical/code";
import { $createLinkNode, $toggleLink } from "@lexical/link";
import {
  $isListItemNode,
  $isListNode,
  type ListItemNode,
  type ListNode,
} from "@lexical/list";
import { $isHeadingNode, $isQuoteNode } from "@lexical/rich-text";
import {
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
  type ElementNode,
  type TextNode,
} from "lexical";
import { withoutAttachTag } from "@/components/forum/composer-insert";

// Replaces the "@" and what follows it, up to the caret, with the mention. A space goes after it
// unless the text already goes on with one.
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

// Takes the tags that place attachment `id` out of the text.
export function $removeAttachTags(id: number) {
  for (const node of $getRoot().getAllTextNodes()) {
    // Code shows a tag as text and is not a place for an attachment: it stays as written.
    if ($isCodeNode(node.getTopLevelElement()) || node.hasFormat("code"))
      continue;
    const text = node.getTextContent();
    const kept = withoutAttachTag(text, id);
    if (kept !== text) node.setTextContent(kept);
  }
}

// The tags that only format their text: formatting that Remove formatting takes off. The others
// (links, mentions, attachments, media, spoilers, code, quotes) carry content and stay.
const FORMATTING_TAG =
  /\[(B|I|U|S|COLOR|FONT|SIZE|LEFT|CENTER|RIGHT|INDENT|ICODE|HEADING)(?:=[^\]\n]*)?\]([\s\S]*?)\[\/\1\]/gi;

function withoutFormattingTags(text: string) {
  let out = text;
  for (let next = out.replace(FORMATTING_TAG, "$2"); next !== out; ) {
    out = next;
    next = out.replace(FORMATTING_TAG, "$2");
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

// A heading, quote or list becomes plain paragraphs; a paragraph loses its alignment and indent.
// Code blocks and anything else stay as they are.
function $plainBlock(block: ElementNode) {
  if ($isHeadingNode(block) || $isQuoteNode(block)) {
    block.replace($createParagraphNode(), true);
  } else if ($isListNode(block)) {
    let after: ElementNode = block;
    for (const item of listItemsOf(block)) {
      const paragraph = $createParagraphNode().append(...item.getChildren());
      after.insertAfter(paragraph);
      after = paragraph;
    }
    block.remove();
  } else if ($isParagraphNode(block)) {
    if (block.getFormatType()) block.setFormat("");
    if (block.getIndent()) block.setIndent(0);
  }
}

// Takes the formatting off the selected text, or off the whole message when nothing is selected:
// bold, italic, underline, strikethrough, inline code, sub- and superscript, any style, headings,
// quotes, lists and alignment, and the formatting BB code tags typed as text. Links, mentions,
// attachments, spoilers and code blocks stay. Call it inside one `editor.update` so that one Undo
// puts everything back.
export function $removeFormatting() {
  const selection = $getSelection();
  const range =
    $isRangeSelection(selection) && !selection.isCollapsed() ? selection : null;
  // Split at the ends of the selection first, so that only the selected text is touched.
  const root = $getRoot();
  const nodes = range ? range.extract() : root.getAllTextNodes();
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
      node.setTextContent(kept);
      for (const point of $isRangeSelection(selection)
        ? [selection.anchor, selection.focus]
        : []) {
        if (point.key === node.getKey() && point.offset > kept.length) {
          point.set(point.key, kept.length, point.type);
        }
      }
    } else {
      node.remove();
    }
  }
  for (const block of blocks) {
    if (block.isAttached()) $plainBlock(block);
  }
  if ($isRangeSelection(selection)) {
    selection.setFormat(0);
    selection.setStyle("");
  }
}
