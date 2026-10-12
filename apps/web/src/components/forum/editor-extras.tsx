"use client";

import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  TRANSFORMERS,
} from "@lexical/markdown";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  type LexicalEditor,
  mergeRegister,
} from "lexical";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { mentionOf } from "@/components/forum/mention-text";
import { cn } from "@/lib/utils";

export type MemberHit = { id: number; username: string };

// The text typed after an "@" that starts a word, up to the caret.
const TYPING = /(?:^|[\s(])@([\p{L}\p{N}._-]{1,32})$/u;

// Adds Markdown at the end of the editor when the page asks for it with a window event whose
// detail is the Markdown (the quote button of a post does).
export function InsertPlugin({ event }: { event: string }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const insert = (occurred: Event) => {
      const markdown = String((occurred as CustomEvent<string>).detail ?? "");
      editor.update(() => {
        const current = $convertToMarkdownString(TRANSFORMERS).trimEnd();
        $convertFromMarkdownString(
          `${current ? `${current}\n\n` : ""}${markdown}\n\n`,
          TRANSFORMERS,
        );
        $getRoot().selectEnd();
      });
      editor.focus();
    };
    window.addEventListener(event, insert);
    return () => window.removeEventListener(event, insert);
  }, [editor, event]);
  return null;
}

// Replaces the "@" and what follows it, up to the caret, with the mention of the chosen member.
function insertMention(editor: LexicalEditor, hit: MemberHit) {
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    const node = selection.anchor.getNode();
    if (!$isTextNode(node)) return;
    const offset = selection.anchor.offset;
    const start = node.getTextContent().slice(0, offset).lastIndexOf("@");
    if (start < 0) return;
    node.spliceText(start, offset - start, `${mentionOf(hit.username)} `, true);
  });
}

// Offers the members whose name starts with what is typed after an "@", and puts the chosen one in
// as the mention the renderer reads. The list is a listbox the editor points to, driven by the
// arrow keys, Enter or Tab, and closed by Escape.
export function MentionPlugin({
  find,
}: {
  find: (prefix: string) => Promise<MemberHit[]>;
}) {
  const t = useTranslations("forum.mentionMenu");
  const [editor] = useLexicalComposerContext();
  const listId = useId();
  const [typed, setTyped] = useState<string | null>(null);
  const [hits, setHits] = useState<MemberHit[]>([]);
  const [active, setActive] = useState(0);
  const open = typed !== null && hits.length > 0;
  const latest = useRef({ open, hits, active });
  latest.current = { open, hits, active };

  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState }) => {
        setTyped(
          editorState.read(() => {
            const selection = $getSelection();
            if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
              return null;
            }
            const node = selection.anchor.getNode();
            if (!$isTextNode(node)) return null;
            const before = node
              .getTextContent()
              .slice(0, selection.anchor.offset);
            return TYPING.exec(before)?.[1] ?? null;
          }),
        );
      }),
    [editor],
  );

  useEffect(() => {
    if (typed === null) {
      setHits([]);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      void find(typed).then((found) => {
        if (!current) return;
        setHits(found);
        setActive(0);
      });
    }, 200);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [typed, find]);

  useEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;
    root.setAttribute("aria-autocomplete", "list");
    if (open) {
      root.setAttribute("aria-controls", listId);
      root.setAttribute("aria-activedescendant", `${listId}-${active}`);
    } else {
      root.removeAttribute("aria-controls");
      root.removeAttribute("aria-activedescendant");
    }
  }, [editor, open, active, listId]);

  useEffect(() => {
    const when = (run: () => void) => (event: KeyboardEvent | null) => {
      if (!latest.current.open || !event) return false;
      event.preventDefault();
      run();
      return true;
    };
    const choose = () => {
      insertMention(editor, latest.current.hits[latest.current.active]);
      setHits([]);
    };
    const step = (by: number) => () => {
      const count = latest.current.hits.length;
      setActive((latest.current.active + by + count) % count);
    };
    return mergeRegister(
      editor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        when(step(1)),
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ARROW_UP_COMMAND,
        when(step(-1)),
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ENTER_COMMAND,
        when(choose),
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_TAB_COMMAND,
        when(choose),
        COMMAND_PRIORITY_HIGH,
      ),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        when(() => setHits([])),
        COMMAND_PRIORITY_HIGH,
      ),
    );
  }, [editor]);

  return (
    <>
      <p role="status" className="sr-only">
        {open ? t("found", { count: hits.length }) : ""}
      </p>
      {open && (
        <div
          id={listId}
          aria-label={t("aria.members")}
          role="listbox"
          className="absolute inset-x-2 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border bg-popover p-1 shadow-md"
        >
          {hits.map((hit, index) => (
            <div
              key={hit.id}
              id={`${listId}-${index}`}
              role="option"
              tabIndex={-1}
              aria-selected={index === active}
              className={cn(
                "flex min-h-10 cursor-pointer items-center rounded-md px-3 text-sm",
                index === active && "bg-muted",
              )}
              onMouseDown={(event) => {
                event.preventDefault();
                insertMention(editor, hit);
                setHits([]);
              }}
            >
              {hit.username}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
