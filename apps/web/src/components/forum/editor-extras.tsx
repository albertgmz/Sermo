"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
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
import {
  createContext,
  type RefObject,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { $appendBb } from "@/components/forum/bb-lexical";
import { mentionOf } from "@/components/forum/bb-text";
import { $insertMention } from "@/components/forum/editor-commands";
import { cn } from "@/lib/utils";

export type MemberHit = { id: number; username: string };

const NONE: MemberHit[] = [];
const CLOSED = { prefix: "", hits: NONE };

// The text typed after an "@" that starts a word, up to the caret.
const TYPING = /(?:^|[\s(])@([\p{L}\p{N}._-]{1,32})$/u;

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

// Replaces the "@" and what follows it, up to the caret, with the mention of the chosen member.
function insertMention(editor: LexicalEditor, hit: MemberHit) {
  editor.update(() => $insertMention(mentionOf(hit.username)));
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
  // The members found, and what had been typed when they were asked for: they stop being offered
  // as soon as the text moves on.
  const [found, setFound] = useState<{ prefix: string; hits: MemberHit[] }>({
    prefix: "",
    hits: [],
  });
  const hits = found.prefix === typed ? found.hits : NONE;
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
    if (typed === null) return;
    let current = true;
    const timer = setTimeout(() => {
      find(typed)
        .catch(() => [])
        .then((hits) => {
          if (!current) return;
          setFound({ prefix: typed, hits });
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
      setFound(CLOSED);
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
        when(() => setFound(CLOSED)),
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
                setFound(CLOSED);
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
