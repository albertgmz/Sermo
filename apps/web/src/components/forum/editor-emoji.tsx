"use client";

import { $isCodeNode } from "@lexical/code";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getSelection, $isRangeSelection, $isTextNode } from "lexical";
import { lazy, Suspense, useEffect, useState } from "react";

// The list itself and the emoji data: asked for when the first ":" is typed, so neither is part of
// the editor's first load.
const EmojiSuggest = lazy(() => import("@/components/forum/emoji-suggest"));

// A ":" that starts a word (after a space, a bracket or another emoji, or at the start of the
// text), then what is typed after it up to the caret, then the ":" that closes a whole shortcode.
// After a letter or a number it is not one: "10:30", "http://", "Nota:".
const TYPED =
  /(?:^|[\s(\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}]|\uFE0F):([\p{L}\p{N}_+-]{0,32})(:?)$/u;

export type EmojiTyped = {
  // What follows the ":".
  query: string;
  // A ":" closes it.
  closed: boolean;
  // How many characters before the caret it takes, both ":" included.
  length: number;
};

export function emojiTyped(before: string): EmojiTyped | null {
  const found = TYPED.exec(before);
  if (!found) return null;
  const [, query, close] = found;
  // ":" alone, or "::".
  if (close && !query) return null;
  return {
    query,
    closed: close !== "",
    length: query.length + 1 + close.length,
  };
}

// What is typed before the caret in the editor, read as an emoji's shortcode; never in code, where
// a ":" is code.
export function $emojiTyped() {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
  const node = selection.anchor.getNode();
  if (!$isTextNode(node) || node.hasFormat("code")) return null;
  if ($isCodeNode(node.getParent())) return null;
  return emojiTyped(node.getTextContent().slice(0, selection.anchor.offset));
}

// Offers emoji for the shortcode typed after a ":", as XenForo does. Until a ":" starts a word it
// only watches; then it loads the list, which does the rest.
export function EmojiPlugin() {
  const [editor] = useLexicalComposerContext();
  const [wanted, setWanted] = useState(false);
  useEffect(() => {
    if (wanted) return;
    return editor.registerUpdateListener(({ editorState }) => {
      if (editorState.read($emojiTyped)) setWanted(true);
    });
  }, [editor, wanted]);
  return wanted ? (
    <Suspense fallback={null}>
      <EmojiSuggest />
    </Suspense>
  ) : null;
}
