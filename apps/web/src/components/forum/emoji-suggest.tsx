"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  BLUR_COMMAND,
  COMMAND_PRIORITY_LOW,
  type EditorState,
  HISTORIC_TAG,
  type LexicalEditor,
  mergeRegister,
} from "lexical";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { $emojiTyped, type EmojiTyped } from "@/components/forum/editor-emoji";
import {
  type EmojiHit,
  emojiOfCode,
  findEmoji,
  fold,
} from "@/components/forum/emoji-find";
import { registerSuggestionKeys } from "@/components/forum/suggestion-keys";
import { Matched, SuggestionList } from "@/components/forum/suggestion-list";

// XenForo asks from the second character on.
const MIN_LENGTH = 2;

// Puts `text` in place of the `length` characters before the caret. A picked emoji is followed by
// a space, as XenForo does, unless the text already goes on with one.
export function $replaceTyped(length: number, text: string, spaced: boolean) {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return;
  const node = selection.anchor.getNode();
  if (!$isTextNode(node)) return;
  const offset = selection.anchor.offset;
  const next = node.getTextContent()[offset];
  const space = spaced && (next === undefined || !/\s/.test(next)) ? " " : "";
  node.spliceText(offset - length, length, `${text}${space}`, true);
}

// A whole shortcode just closed with its ":" (":thinking:") becomes its emoji.
export function $convertClosed() {
  const typed = $emojiTyped();
  const emoji = typed?.closed && emojiOfCode(typed.query);
  if (typed && emoji) $replaceTyped(typed.length, emoji, false);
}

// Tells `onTyped` what shortcode is being typed before the caret after each change (null for none,
// or one just closed), and turns a closed one into its emoji. Not when Undo or Redo puts the text
// back (Undo after the change gives the shortcode back, and it stays), nor in the middle of a
// composition, which a phone's keyboard is still writing (it is turned when the composition ends).
// What is in the text when it starts (typed while the list was on its way) is read at once.
export function registerEmojiTyping(
  editor: LexicalEditor,
  onTyped: (typed: EmojiTyped | null) => void,
) {
  const read = (state: EditorState, tags: Set<string>) => {
    const now = state.read($emojiTyped);
    onTyped(now?.closed ? null : now);
    if (now?.closed && !tags.has(HISTORIC_TAG) && !editor.isComposing()) {
      editor.update($convertClosed);
    }
  };
  const unregister = editor.registerUpdateListener(({ editorState, tags }) =>
    read(editorState, tags),
  );
  read(editor.getEditorState(), new Set());
  return unregister;
}

function pick(
  editor: LexicalEditor,
  typed: { length: number } | undefined,
  hit: EmojiHit,
) {
  if (typed) editor.update(() => $replaceTyped(typed.length, hit.emoji, true));
}

// The emoji list of the editor's composers (`EmojiPlugin` loads it when a shortcode is first typed): ":" and two
// characters offer the emoji whose shortcode, name or keywords hold them, in English and Spanish;
// the arrow keys move, Enter or Tab picks, Escape closes it until something else is typed, and a
// press picks too. The picked emoji takes the place of the ":" and what follows.
export default function EmojiSuggest() {
  const t = useTranslations("editor.editor");
  const locale = useLocale();
  const [editor] = useLexicalComposerContext();
  const [typed, setTyped] = useState<{ query: string; length: number }>();
  const [active, setActive] = useState(0);
  // The query Escape closed the list on: it stays closed until the query changes.
  const [closedOn, setClosedOn] = useState<string>();
  const query = typed?.query ?? "";
  const hits =
    typed && query.length >= MIN_LENGTH && query !== closedOn
      ? findEmoji(query, locale)
      : [];
  const latest = useRef({ hits, active, typed });
  latest.current = { hits, active, typed };

  useEffect(
    () =>
      mergeRegister(
        registerEmojiTyping(editor, (now) => {
          setTyped(now ?? undefined);
          setActive(0);
          // Escape closes the list on one shortcode, not on the next one that is the same.
          if (!now) setClosedOn(undefined);
        }),
        // Gone when the text loses the focus (a press on the list keeps it), as XenForo's is.
        editor.registerCommand(
          BLUR_COMMAND,
          () => {
            setTyped(undefined);
            return false;
          },
          COMMAND_PRIORITY_LOW,
        ),
      ),
    [editor],
  );

  useEffect(
    () =>
      registerSuggestionKeys(
        editor,
        () => ({
          count: latest.current.hits.length,
          active: latest.current.active,
        }),
        {
          move: setActive,
          pick: (index) =>
            pick(editor, latest.current.typed, latest.current.hits[index]),
          close: () => setClosedOn(latest.current.typed?.query),
        },
      ),
    [editor],
  );

  return (
    <SuggestionList
      owner={editor.getRootElement()}
      label={t("emojiLabel")}
      status={hits.length > 0 ? t("emojiFound", { count: hits.length }) : ""}
      options={hits}
      active={active}
      optionKey={(hit) => hit.emoji}
      renderOption={(hit) => (
        <>
          <span
            aria-hidden
            className="w-7 shrink-0 text-center text-2xl leading-none"
          >
            {hit.emoji}
          </span>
          <span className="min-w-0">
            <span className="block truncate">
              :<Matched text={hit.code} query={fold(query)} />:
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {hit.name}
            </span>
          </span>
        </>
      )}
      onPick={(hit) => pick(editor, typed, hit)}
    />
  );
}
