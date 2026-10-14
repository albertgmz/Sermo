import { $createLinkNode, $toggleLink } from "@lexical/link";
import {
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
} from "lexical";

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
