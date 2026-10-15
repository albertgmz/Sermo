import {
  $createRangeSelection,
  $getRoot,
  $setSelection,
  type TextNode,
} from "lexical";
import { TAG_SOURCE, tagOf } from "@/components/forum/bb-scan";

// Where the caret or the selection of the plain box goes when the editor takes its place. A place in
// the BB code is a place in the text only roughly (the tags are not text, and the editor shows some
// of them as text), so the place is counted in characters of the text that are not spaces: the
// caret lands after as many of them as were before it in the box.

const SPACE = /\s/;

// The characters that are not space in the text of `source` before `offset`: what is inside a tag
// ([B], [/URL]...) is not counted.
export function charsBefore(source: string, offset: number): number {
  const tags = new RegExp(TAG_SOURCE, "g");
  let count = 0;
  let at = 0;
  const countText = (to: number) => {
    for (let i = at; i < Math.min(to, offset); i++) {
      if (!SPACE.test(source[i])) count++;
    }
  };
  for (let m = tags.exec(source); m; m = tags.exec(source)) {
    if (m.index >= offset) break;
    if (!tagOf(m)) {
      tags.lastIndex = m.index + 1;
      continue;
    }
    countText(m.index);
    at = m.index + m[0].length;
  }
  countText(offset);
  return count;
}

// A point in the editor's text after `chars` characters that are not space (inside the text node it
// is in), or the start of the text for none.
function pointAfter(chars: number): { node: TextNode; offset: number } | null {
  const nodes = $getRoot().getAllTextNodes();
  if (!nodes.length) return null;
  let seen = 0;
  for (const node of nodes) {
    const text = node.getTextContent();
    for (let i = 0; i < text.length; i++) {
      if (seen === chars) return { node, offset: i };
      if (!SPACE.test(text[i])) seen++;
    }
    if (seen === chars) return { node, offset: text.length };
  }
  const last = nodes[nodes.length - 1];
  return { node: last, offset: last.getTextContentSize() };
}

// Puts the selection of the editor where the box had its own: `start` and `end` are the offsets of
// its selection in `source`, the text the editor was made from.
export function $placeSelection(source: string, start: number, end: number) {
  const from = pointAfter(charsBefore(source, start));
  const to = end === start ? from : pointAfter(charsBefore(source, end));
  if (!from || !to) return;
  const selection = $createRangeSelection();
  selection.anchor.set(from.node.getKey(), from.offset, "text");
  selection.focus.set(to.node.getKey(), to.offset, "text");
  $setSelection(selection);
}
