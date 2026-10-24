"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  BLUR_COMMAND,
  COMMAND_PRIORITY_LOW,
  type LexicalEditor,
  mergeRegister,
} from "lexical";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { mentionOf } from "@/components/forum/bb-text";
import {
  $insertMention,
  mentionInText,
} from "@/components/forum/editor-commands";
import { $mentionTyped, mentionBefore } from "@/components/forum/editor-extras";
import type { MentionHit } from "@/components/forum/mention-find";
import { registerSuggestionKeys } from "@/components/forum/suggestion-keys";
import { Matched, SuggestionList } from "@/components/forum/suggestion-list";
import { textareaCaretRect } from "@/components/forum/textarea-caret";
import { userNameProps } from "@/components/forum/user-name";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

const NONE: MentionHit[] = [];
const NOTHING = { prefix: "", hits: NONE };

// Tells `onTyped` the name typed after an "@" before the caret after each change (null for none).
// What is in the text when it starts (typed while the list was on its way) is read at once, unless
// the member has left the text.
export function registerMentionTyping(
  editor: LexicalEditor,
  onTyped: (typed: string | null) => void,
) {
  const unregister = editor.registerUpdateListener(({ editorState }) =>
    onTyped(editorState.read($mentionTyped)),
  );
  const root = editor.getRootElement();
  const away = root !== null && !root.contains(document.activeElement);
  onTyped(away ? null : editor.getEditorState().read($mentionTyped));
  return unregister;
}

// The small avatar of a member in the list: their picture (left out by `findMentions` when the
// visitor switched avatars off), or their initials.
function MentionAvatar({ hit }: { hit: MentionHit }) {
  return (
    <Avatar aria-hidden className="size-8">
      {hit.avatar ? (
        <AvatarImage src={hit.avatar} alt="" />
      ) : (
        <AvatarFallback
          data-initials={hit.username.slice(0, 2)}
          className="text-xs font-semibold uppercase after:content-[attr(data-initials)]"
        />
      )}
    </Avatar>
  );
}

// One member of the list, told apart as XenForo draws names: the avatar, the name in its colour
// (held readable in the theme, `.ink`) and in bold for staff, what was typed underlined (the weight
// already says staff), and the title on a second line, with room above and below.
export function MentionOption({
  hit,
  query,
}: {
  hit: MentionHit;
  query: string;
}) {
  const name = userNameProps(hit);
  return (
    <>
      <MentionAvatar hit={hit} />
      <span className={cn("min-w-0", hit.title && "py-1")}>
        <span
          className={cn(
            "block truncate",
            hit.staff ? "font-bold" : "font-normal",
            name.className,
          )}
          style={name.style}
        >
          <Matched
            text={hit.username}
            query={query}
            mark="underline decoration-2 underline-offset-2"
          />
        </span>
        {hit.title && (
          <span className="block truncate text-xs text-muted-foreground">
            {hit.title}
          </span>
        )}
      </span>
    </>
  );
}

// The members found for the name typed after an "@" (`typed`, null for none): asked for `find`
// once typing pauses, and offered only while the text stays on the name they were asked for. The
// active one moves with `setActive`; `close` hides the list until the name changes.
function useMemberHits(
  find: (prefix: string) => Promise<MentionHit[]>,
  typed: string | null,
) {
  // The members found, and what had been typed when they were asked for: they stop being offered
  // as soon as the text moves on.
  const [found, setFound] = useState(NOTHING);
  const [active, setActive] = useState(0);
  // The name Escape closed the list on: it stays closed until the name changes.
  const [closedOn, setClosedOn] = useState<string>();
  const hits =
    typed !== null && found.prefix === typed && typed !== closedOn
      ? found.hits
      : NONE;
  const latest = useRef({ hits, active, typed });
  latest.current = { hits, active, typed };

  useEffect(() => {
    if (typed === null) setClosedOn(undefined);
  }, [typed]);

  useEffect(() => {
    if (typed === null) return;
    let current = true;
    const timer = setTimeout(() => {
      find(typed)
        .catch(() => NONE)
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

  return {
    hits,
    active,
    setActive,
    latest,
    close: () => setClosedOn(latest.current.typed ?? undefined),
    clear: () => setFound(NOTHING),
  };
}

// The member list of the editor's composers (`MentionPlugin` loads it when a name is first typed
// after an "@"): the members whose name starts with what is typed, asked for `find` once typing
// pauses; the arrow keys move, Enter or Tab picks, Escape closes it until something else is typed,
// and a press picks too. The picked member becomes the mention the renderer reads.
export default function MentionSuggest({
  find,
}: {
  find: (prefix: string) => Promise<MentionHit[]>;
}) {
  const [editor] = useLexicalComposerContext();
  const [typed, setTyped] = useState<string | null>(null);
  const { hits, active, setActive, latest, close, clear } = useMemberHits(
    find,
    typed,
  );

  const pick = (hit: MentionHit) => {
    editor.update(() => $insertMention(mentionOf(hit.username, hit.id)));
    clear();
  };
  const picked = useRef(pick);
  picked.current = pick;

  useEffect(
    () =>
      mergeRegister(
        registerMentionTyping(editor, setTyped),
        // Gone when the text loses the focus (a press on the list keeps it).
        editor.registerCommand(
          BLUR_COMMAND,
          () => {
            setTyped(null);
            return false;
          },
          COMMAND_PRIORITY_LOW,
        ),
      ),
    [editor],
  );

  const closing = useRef(close);
  closing.current = close;
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
          pick: (index) => picked.current(latest.current.hits[index]),
          close: () => closing.current(),
        },
      ),
    [editor, latest, setActive],
  );

  return (
    <MemberList
      owner={editor.getRootElement()}
      hits={hits}
      active={active}
      typed={typed}
      onPick={pick}
    />
  );
}

function MemberList({
  owner,
  hits,
  active,
  typed,
  onPick,
  caretAt,
}: {
  owner: HTMLElement | null;
  hits: MentionHit[];
  active: number;
  typed: string | null;
  onPick: (hit: MentionHit) => void;
  caretAt?: () => { top: number; bottom: number; left: number } | null;
}) {
  const t = useTranslations("forum.mentionMenu");
  return (
    <SuggestionList
      owner={owner}
      label={t("aria.members")}
      status={hits.length > 0 ? t("found", { count: hits.length }) : ""}
      options={hits}
      active={active}
      optionKey={(hit) => String(hit.id)}
      renderOption={(hit) => <MentionOption hit={hit} query={typed ?? ""} />}
      onPick={onPick}
      caretAt={caretAt}
    />
  );
}

// The same list over the BB code source field, a plain text field (`SourceMentionPlugin` loads it):
// the name typed is read from the text before the caret, the keys are the field's, and a picked
// member is written into the text as the BB code the rich text would have made.
export function SourceSuggest({
  find,
  field,
  commit,
}: {
  find: (prefix: string) => Promise<MentionHit[]>;
  field: HTMLTextAreaElement;
  commit: (text: string) => void;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  const { hits, active, setActive, latest, close, clear } = useMemberHits(
    find,
    typed,
  );

  const pick = (hit: MentionHit) => {
    const caret = field.selectionStart;
    const next = mentionInText(
      field.value,
      caret,
      mentionOf(hit.username, hit.id),
    );
    field.value = next.text;
    field.setSelectionRange(next.caret, next.caret);
    commit(next.text);
    setTyped(null);
    clear();
  };
  const latestActions = useRef({ pick, close, setActive });
  latestActions.current = { pick, close, setActive };

  useEffect(() => {
    const read = () =>
      setTyped(
        document.activeElement === field
          ? mentionBefore(field.value.slice(0, field.selectionStart))
          : null,
      );
    const lose = () => setTyped(null);
    const keys = (event: KeyboardEvent) => {
      const now = latest.current;
      if (now.hits.length === 0) return;
      const act = latestActions.current;
      const by =
        event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
      if (by !== 0) {
        act.setActive((now.active + by + now.hits.length) % now.hits.length);
      } else if (event.key === "Enter" || event.key === "Tab") {
        act.pick(now.hits[now.active]);
      } else if (event.key === "Escape") {
        act.close();
      } else {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    read();
    field.addEventListener("input", read);
    field.addEventListener("keyup", read);
    field.addEventListener("click", read);
    field.addEventListener("blur", lose);
    field.addEventListener("keydown", keys);
    return () => {
      field.removeEventListener("input", read);
      field.removeEventListener("keyup", read);
      field.removeEventListener("click", read);
      field.removeEventListener("blur", lose);
      field.removeEventListener("keydown", keys);
    };
  }, [field, latest]);

  return (
    <MemberList
      owner={field}
      hits={hits}
      active={active}
      typed={typed}
      onPick={pick}
      caretAt={() => textareaCaretRect(field)}
    />
  );
}
