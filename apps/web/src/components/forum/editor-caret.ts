import {
  $createRangeSelection,
  $getRoot,
  $setSelection,
  type TextNode,
} from "lexical";
import { closersOf, parseBb, textChars } from "@/components/forum/bb-parse";
import {
  closerFinder,
  literalContentOk,
  readsLiterally,
  TAG_SOURCE,
  tagOf,
} from "@/components/forum/bb-scan";

// Where the caret or the selection of the plain box goes when the editor takes its place. A place in
// the BB code is a place in the text only roughly (the tags are not text, and the editor shows some
// of them as text), so the place is counted in characters of the text that are not spaces: the
// caret lands after as many of them as were before it in the box.

const SPACE = /\s/;
// Tags whose content is text in the editor although the tags are not: code and a bare address.
const SHOWN_CONTENT = new Set(["CODE", "ICODE", "URL"]);

// The characters that are not space in the text the editor shows before `offset` of `source`. The
// editor's own reading counts them: a tag it shows as text (a colour, a spoiler...) is counted, one it
// shows as formatting is not, and a format still open at the offset is closed so that its tag is not
// read as text.
export function charsBefore(source: string, offset: number): number {
  // Not in the middle of a tag.
  let end = Math.min(offset, source.length);
  const open = source.lastIndexOf("[", end - 1);
  // Only a tag's start counts (`[B`, `[/I`, `[*`): an emoticon `:[`, `[1` or `a[0` is text.
  if (
    open >= 0 &&
    /^\[\/?[A-Za-z*]/.test(source.slice(open, end)) &&
    !source.slice(open, end).includes("]")
  )
    end = open;
  // Inside code or a bare address, whose content is text: what is before it is read as usual and
  // its content counts as it is.
  const find = closerFinder(source);
  const tags = new RegExp(TAG_SOURCE, "g");
  let cut = end;
  let inside = 0;
  for (let m = tags.exec(source); m && m.index < end; m = tags.exec(source)) {
    const tag = tagOf(m);
    if (!tag) {
      tags.lastIndex = m.index + 1;
      continue;
    }
    if (tag.closing || !readsLiterally(tag.name, tag.option)) continue;
    const from = m.index + m[0].length;
    const closer = find(tag.name, from);
    if (closer < 0 || !literalContentOk(tag.name, source.slice(from, closer))) {
      continue;
    }
    if (closer >= end && SHOWN_CONTENT.has(tag.name)) {
      cut = m.index;
      inside = source.slice(from, end).replace(/\s/g, "").length;
      break;
    }
    tags.lastIndex = closer + tag.name.length + 3;
  }
  const head = source.slice(0, cut);
  // A character is put where the text ends, so that a list item or a format with nothing in it
  // yet is still one.
  return textChars(parseBb(`${head}x${closersOf(`${head}x`)}`)) - 1 + inside;
}

// A point in the editor's text after `chars` characters that are not space (inside the text node it
// is in), or the start of the text for none.
function pointAfter(
  chars: number,
  lineStart: boolean,
): { node: TextNode; offset: number } | null {
  const nodes = $getRoot().getAllTextNodes();
  if (!nodes.length) return null;
  let seen = 0;
  for (const node of nodes) {
    const text = node.getTextContent();
    for (let i = 0; i < text.length; i++) {
      // After a line break or a tag the caret goes before the next character, not after the last.
      if (seen === chars && !(lineStart && SPACE.test(text[i]))) {
        return { node, offset: i };
      }
      if (!SPACE.test(text[i])) seen++;
    }
    if (seen === chars && !lineStart) return { node, offset: text.length };
  }
  const last = nodes[nodes.length - 1];
  return { node: last, offset: last.getTextContentSize() };
}

// A quote is a block the caret cannot enter: a place in one is the place after it.
function afterQuote(source: string, offset: number): number {
  for (const block of parseBb(source)) {
    if (block.t === "quote" && block.at < offset) {
      const end = block.at + block.raw.length;
      if (offset < end) return end;
    }
  }
  return offset;
}

// Puts the selection of the editor where the box had its own: `start` and `end` are the offsets of
// its selection in `source`, the text the editor was made from.
export function $placeSelection(source: string, from: number, to: number) {
  const start = afterQuote(source, from);
  const end = afterQuote(source, to);
  const anchor = pointAfter(
    charsBefore(source, start),
    start > 0 && (source[start - 1] === "\n" || source[start - 1] === "]"),
  );
  const focus =
    end === start ? anchor : pointAfter(charsBefore(source, end), false);
  if (!anchor || !focus) return;
  const selection = $createRangeSelection();
  selection.anchor.set(anchor.node.getKey(), anchor.offset, "text");
  selection.focus.set(focus.node.getKey(), focus.offset, "text");
  $setSelection(selection);
}
