"use client";

import { $isCodeNode } from "@lexical/code";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getSelection, $isRangeSelection, $isTextNode } from "lexical";
import { type ComponentType, useEffect, useState } from "react";

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

// A letter or a number follows the ":": a shortcode, not an emoticon such as ":)" or ":-)".
export function shortcodeStarted(typed: EmojiTyped | null) {
  return typed !== null && /[\p{L}\p{N}]/u.test(typed.query);
}

// Calls `start` when a shortcode starts: what is before the caret reads as one, and did not at the
// change before. More keys or caret moves in the same shortcode call nothing.
export function onShortcodeStart(start: () => void) {
  let started = false;
  return (typed: EmojiTyped | null) => {
    const now = shortcodeStarted(typed);
    if (now && !started) start();
    started = now;
  };
}

// Calls `load` when asked, one load at a time, and hands what it gives to `done`. A load that fails
// (a connection that drops, a page opened before the site was updated and whose files are gone) is
// asked for again on the next call.
export function loader<T>(load: () => Promise<T>, done: (loaded: T) => void) {
  let asked = false;
  return () => {
    if (asked) return;
    asked = true;
    load().then(done, () => {
      asked = false;
    });
  };
}

// Offers emoji for the shortcode typed after a ":", as XenForo does. Until a letter or a number
// follows a ":" that starts a word it only watches (":)" asks for nothing); then it loads the list
// and the emoji data, which do the rest, so neither is part of the editor's first load. A failed
// load leaves the text as it is, and the next shortcode typed asks again.
export function EmojiPlugin() {
  const [editor] = useLexicalComposerContext();
  const [Suggest, setSuggest] = useState<ComponentType>();
  useEffect(() => {
    if (Suggest) return;
    const ask = loader(
      () => import("@/components/forum/emoji-suggest"),
      (loaded) => setSuggest(() => loaded.default),
    );
    const typed = onShortcodeStart(ask);
    return editor.registerUpdateListener(({ editorState }) =>
      typed(editorState.read($emojiTyped)),
    );
  }, [editor, Suggest]);
  return Suggest ? <Suggest /> : null;
}
