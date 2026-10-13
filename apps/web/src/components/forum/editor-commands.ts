import { $createLinkNode, $toggleLink } from "@lexical/link";
import {
  $createTextNode,
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
