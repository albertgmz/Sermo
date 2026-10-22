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
import { $insertMention } from "@/components/forum/editor-commands";
import { $mentionTyped } from "@/components/forum/editor-extras";
import type { MentionHit } from "@/components/forum/mention-find";
import { registerSuggestionKeys } from "@/components/forum/suggestion-keys";
import { Matched, SuggestionList } from "@/components/forum/suggestion-list";
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
// already says staff), and the title on a second line.
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
      <span className="min-w-0">
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
            mark="[font-weight:inherit] text-inherit underline decoration-2 underline-offset-2"
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

// The member list of the editor's composers (`MentionPlugin` loads it when a name is first typed
// after an "@"): the members whose name starts with what is typed, asked for `find` once typing
// pauses; the arrow keys move, Enter or Tab picks, Escape closes it until something else is typed,
// and a press picks too. The picked member becomes the mention the renderer reads.
export default function MentionSuggest({
  find,
}: {
  find: (prefix: string) => Promise<MentionHit[]>;
}) {
  const t = useTranslations("forum.mentionMenu");
  const [editor] = useLexicalComposerContext();
  const [typed, setTyped] = useState<string | null>(null);
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

  const pick = (hit: MentionHit) => {
    editor.update(() => $insertMention(mentionOf(hit.username, hit.id)));
    setFound(NOTHING);
  };
  const picked = useRef(pick);
  picked.current = pick;

  useEffect(
    () =>
      mergeRegister(
        registerMentionTyping(editor, (now) => {
          setTyped(now);
          if (now === null) setClosedOn(undefined);
        }),
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
          close: () => setClosedOn(latest.current.typed ?? undefined),
        },
      ),
    [editor],
  );

  return (
    <SuggestionList
      owner={editor.getRootElement()}
      label={t("aria.members")}
      status={hits.length > 0 ? t("found", { count: hits.length }) : ""}
      options={hits}
      active={active}
      optionKey={(hit) => String(hit.id)}
      renderOption={(hit) => <MentionOption hit={hit} query={typed ?? ""} />}
      onPick={pick}
    />
  );
}
