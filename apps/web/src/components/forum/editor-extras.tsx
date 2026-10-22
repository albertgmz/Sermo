"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getSelection, $isRangeSelection, $isTextNode } from "lexical";
import {
  type ComponentType,
  createContext,
  type RefObject,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { $appendBb } from "@/components/forum/bb-lexical";
import { loader } from "@/components/forum/editor-emoji";
import type { MentionHit } from "@/components/forum/mention-find";

export type MemberHit = MentionHit;

type SuggestProps = { find: (prefix: string) => Promise<MemberHit[]> };

// The text typed after an "@" that starts a word, up to the caret. It may start with a symbol:
// imported accounts hold names such as "#Bishop" or "$kyw".
export const TYPING = /(?:^|[\s(])@([^\s@]{1,32})$/u;

// The BB code source field the editor shows in place of its rich text. `active` says whether it is
// shown; the rest is for what the rest of the composer asks of the text (a quote, an attachment's
// tag), which goes to the field while it is the one showing.
export type SourceMode = {
  active: boolean;
  field: RefObject<HTMLTextAreaElement | null>;
  // The text of the field changed.
  commit: (text: string) => void;
  toggle: () => void;
};

export const SourceContext = createContext<SourceMode | null>(null);

// Adds BB code at the end of the editor when the page asks for it with a window event whose
// detail is the BB code (the quote button of a post does).
export function InsertPlugin({ event }: { event: string }) {
  const [editor] = useLexicalComposerContext();
  const source = useContext(SourceContext);
  const mode = useRef(source);
  mode.current = source;
  useEffect(() => {
    const insert = (occurred: Event) => {
      const bb = String((occurred as CustomEvent<string>).detail ?? "");
      const shown = mode.current;
      const box = shown?.active ? shown.field.current : null;
      if (box) {
        const current = box.value.trimEnd();
        box.value = `${current ? `${current}\n\n` : ""}${bb}\n\n`;
        box.setSelectionRange(box.value.length, box.value.length);
        box.focus();
        shown?.commit(box.value);
        return;
      }
      editor.update(() => $appendBb(`${bb}\n\n`));
      editor.focus();
    };
    window.addEventListener(event, insert);
    return () => window.removeEventListener(event, insert);
  }, [editor, event]);
  return null;
}

// What is typed after an "@" that starts a word, up to the caret; null when no name is being typed.
export function $mentionTyped() {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
  const node = selection.anchor.getNode();
  if (!$isTextNode(node)) return null;
  return (
    TYPING.exec(node.getTextContent().slice(0, selection.anchor.offset))?.[1] ??
    null
  );
}

// Calls `start` when a name starts being typed after an "@"; more keys in the same name call
// nothing, so a list that failed to load is asked for again on the next name, not on every key.
export function onMentionStart(start: () => void) {
  let started = false;
  return (typed: string | null) => {
    if (typed !== null && !started) start();
    started = typed !== null;
  };
}

// Offers the members whose name starts with what is typed after an "@" (`find`). Until a name is
// typed it only watches; then it loads the list (`MentionSuggest`), which does the rest, so the
// list is not part of the editor's first load.
export function MentionPlugin({
  find,
}: {
  find: (prefix: string) => Promise<MemberHit[]>;
}) {
  const [editor] = useLexicalComposerContext();
  const [Suggest, setSuggest] = useState<ComponentType<SuggestProps>>();
  useEffect(() => {
    if (Suggest) return;
    const typed = onMentionStart(
      loader(
        () => import("@/components/forum/mention-suggest"),
        (loaded) => setSuggest(() => loaded.default),
      ),
    );
    return editor.registerUpdateListener(({ editorState }) =>
      typed(editorState.read($mentionTyped)),
    );
  }, [editor, Suggest]);
  return Suggest ? <Suggest find={find} /> : null;
}
