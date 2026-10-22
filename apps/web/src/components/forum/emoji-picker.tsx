"use client";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $getSelection,
  $isRangeSelection,
  $setSelection,
  type BaseSelection,
  type LexicalEditor,
  SKIP_SCROLL_INTO_VIEW_TAG,
} from "lexical";
import {
  Car,
  Clock,
  Flag,
  Heart,
  Laugh,
  Lightbulb,
  type LucideIcon,
  PawPrint,
  PersonStanding,
  Smile,
  Utensils,
  Volleyball,
  X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { $insertText } from "@/components/forum/editor-commands";
import {
  type Emoji,
  emojiGroups,
  type GroupKey,
  searchEmoji,
} from "@/components/forum/emoji-find";
import {
  type KeyAction,
  type KeyPlace,
  registerPickerKeys,
} from "@/components/forum/emoji-picker-keys";
import { RECENT_KEY, TONE_KEY } from "@/components/forum/emoji-storage";
import { listSmilies } from "@/components/forum/smilie-action";
import { knownSmilies, loadSmilies } from "@/components/forum/smilie-store";
import type { Smilie } from "@/lib/smilies";

const RECENT_LIMIT = 24;
const TONES = [
  "default",
  "light",
  "mediumLight",
  "medium",
  "mediumDark",
  "dark",
] as const;

function stored(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

// A browser that keeps nothing (private mode, storage off) just does not remember.
function storeRecent(value: string) {
  try {
    window.localStorage.setItem(RECENT_KEY, value);
  } catch {}
}

function storeTone(value: string) {
  try {
    window.localStorage.setItem(TONE_KEY, value);
  } catch {}
}

export function readRecent(): string[] {
  try {
    const value: unknown = JSON.parse(stored(RECENT_KEY) ?? "[]");
    return Array.isArray(value)
      ? value.filter((item) => typeof item === "string").slice(0, RECENT_LIMIT)
      : [];
  } catch {
    return [];
  }
}

// `text` first, once, the oldest dropped past the limit.
export function withRecent(recent: string[], text: string) {
  return [text, ...recent.filter((item) => item !== text)].slice(
    0,
    RECENT_LIMIT,
  );
}

function readTone() {
  const tone = Number(stored(TONE_KEY));
  return Number.isInteger(tone) && tone >= 0 && tone < TONES.length ? tone : 0;
}

// One thing the picker offers: what goes into the text, what is shown, and its name.
type Choice = { text: string; glyph: string; label: string };

const ofEmoji = (item: Emoji, tone: number, locale: string): Choice => {
  const glyph = (tone > 0 && item.skins?.[tone - 1]) || item.emoji;
  return { text: glyph, glyph, label: locale === "es" ? item.es : item.en };
};

const ofSmilie = (smilie: Smilie): Choice => ({
  text: smilie.codes[0],
  glyph: smilie.emoji,
  label: `${smilie.title} ${smilie.codes[0]}`,
});

type SectionId = "recent" | "smilies" | "results" | GroupKey;
type Section = { id: SectionId; title: string; choices: Choice[] };

// The fixed icon of each section in the row that jumps to it, as XenForo's and every picker's.
const SECTION_ICONS: Record<Exclude<SectionId, "results">, LucideIcon> = {
  recent: Clock,
  smilies: Smile,
  "smileys-emotion": Laugh,
  "people-body": PersonStanding,
  "animals-nature": PawPrint,
  "food-drink": Utensils,
  "travel-places": Car,
  activities: Volleyball,
  objects: Lightbulb,
  symbols: Heart,
  flags: Flag,
};

// The picker's sections when nothing is searched, in XenForo's order: recently used, the site's
// smilies, then the emoji by group.
export function pickerSections(
  recent: string[],
  smilies: Smilie[],
  tone: number,
  locale: string,
  names: { recent: string; smilies: string; group: (key: GroupKey) => string },
): Section[] {
  const groups = emojiGroups();
  const known = new Map<string, Choice>();
  for (const smilie of smilies)
    for (const code of smilie.codes)
      known.set(code, { ...ofSmilie(smilie), text: code });
  for (const item of groups.flatMap((group) => group.emoji)) {
    const choice = ofEmoji(item, 0, locale);
    for (const glyph of [item.emoji, ...(item.skins ?? [])])
      if (!known.has(glyph))
        known.set(glyph, { ...choice, text: glyph, glyph });
  }
  const sections: Section[] = [
    {
      id: "recent",
      title: names.recent,
      choices: recent.flatMap((text) => known.get(text) ?? []),
    },
    { id: "smilies", title: names.smilies, choices: smilies.map(ofSmilie) },
    ...groups.map((group) => ({
      id: group.key,
      title: names.group(group.key),
      choices: group.emoji.map((item) => ofEmoji(item, tone, locale)),
    })),
  ];
  return sections.filter((section) => section.choices.length > 0);
}

// How many options the row of `option` holds: those beside it at the same height.
function columnsOf(options: HTMLElement[], option: HTMLElement) {
  const row = options.filter(
    (other) =>
      other.parentElement === option.parentElement &&
      other.offsetTop === option.offsetTop,
  );
  return Math.max(row.length, 1);
}

// What the search box finds for `query`, as one section.
export function resultSection(
  query: string,
  locale: string,
  smilies: Smilie[],
  title: string,
): Section {
  return {
    id: "results",
    title,
    choices: searchEmoji(query, locale, smilies).map((hit) =>
      hit.smilie
        ? { text: hit.code, glyph: hit.emoji, label: `${hit.name} ${hit.code}` }
        : { text: hit.emoji, glyph: hit.emoji, label: hit.name },
    ),
  };
}

// Puts `text` in at the caret (or at `caret`, where it was before the focus came to the picker)
// and answers where the caret is after it. The page is not scrolled to the caret: on a phone the
// picker would go out of view.
export function insertChoice(
  editor: LexicalEditor,
  text: string,
  caret: BaseSelection | null,
) {
  let after = caret;
  editor.update(
    () => {
      if (!$isRangeSelection($getSelection()) && caret)
        $setSelection(caret.clone());
      $insertText(text);
      after = $getSelection()?.clone() ?? null;
    },
    { tag: SKIP_SCROLL_INTO_VIEW_TAG },
  );
  return after;
}

// The picker's parts its keys need, read when a key is pressed.
export type PickerParts = {
  search: () => EventTarget | null;
  options: () => HTMLElement[];
  query: () => string;
  sections: () => Section[];
  pick: (choice: Choice) => void;
  close: () => void;
};

// Wires the picker's keys (`emoji-picker-keys.ts`) to its parts, on its element.
export function registerPicker(element: EventTarget, parts: PickerParts) {
  const placeOf = (event: KeyboardEvent): KeyPlace => {
    if (event.target === parts.search())
      return { in: "search", empty: !parts.query().trim() };
    const all = parts.options();
    const target = event.target as HTMLElement;
    const index = all.indexOf(target);
    return index < 0
      ? { in: "other" }
      : {
          in: "option",
          index,
          count: all.length,
          columns: columnsOf(all, target),
        };
  };
  const act = (action: KeyAction) => {
    if (action.do === "close") parts.close();
    else if (action.do === "pickFirst") {
      const first = parts
        .sections()
        .find((section) => section.choices.length > 0)?.choices[0];
      if (first) parts.pick(first);
    } else if (action.do === "focus") {
      const option = parts.options()[action.index];
      option?.focus();
      option?.scrollIntoView({ block: "nearest" });
    }
  };
  return registerPickerKeys(element, placeOf, act);
}

// The emoji picker of the editor's bar (`EmojiButton` loads it on the first press): every emoji by
// Emojibase's groups, the site's smilies and the recently used ones, a search in English and Spanish
// and a skin tone. A press puts the emoji (or a smilie's code) in at the caret and keeps the focus
// where it was, so a phone keeps its keyboard; the picker stays open for more. From the keyboard:
// Tab reaches the search box (Enter there picks the first result), the down arrow the options,
// the arrows move, Enter picks and Escape closes it, back in the text (`emoji-picker-keys.ts`). Below
// `sm` the grid is three rows high, so the line being written stays in view over a phone's keyboard.
export default function EmojiPicker({
  focusSearch,
  onClose,
}: {
  focusSearch: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("editor.editor");
  const locale = useLocale();
  const [editor] = useLexicalComposerContext();
  const [query, setQuery] = useState("");
  const [smilies, setSmilies] = useState(knownSmilies);
  const [tone, setTone] = useState(readTone);
  // Read once on opening: what is picked now does not move the options under the pointer.
  const [recent] = useState(readRecent);
  const search = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLFieldSetElement>(null);
  // Two editors on one page (a quick reply and an inline edit) each have their own headings.
  const ids = useId();
  // Where the caret was in the text, for picks made while the focus is in the picker.
  const caret = useRef<BaseSelection | null>(null);

  useEffect(() => {
    caret.current = editor
      .getEditorState()
      .read(() => $getSelection()?.clone() ?? null);
    loadSmilies(listSmilies).then(setSmilies);
    if (focusSearch) search.current?.focus();
  }, [editor, focusSearch]);

  const sections = useMemo(
    () =>
      query.trim()
        ? [resultSection(query, locale, smilies, t("emojiResults"))]
        : pickerSections(recent, smilies, tone, locale, {
            recent: t("emojiRecent"),
            smilies: t("emojiSmilies"),
            group: (key) => t(`emojiGroups.${key}`),
          }),
    [query, locale, smilies, recent, tone, t],
  );

  function pick(choice: Choice) {
    caret.current = insertChoice(editor, choice.text, caret.current);
    storeRecent(JSON.stringify(withRecent(readRecent(), choice.text)));
  }

  function close() {
    onClose();
    editor.focus();
  }

  const latest = useRef({ query, sections, pick, close });
  latest.current = { query, sections, pick, close };
  useEffect(() => {
    if (!root.current) return;
    return registerPicker(root.current, {
      search: () => search.current,
      options: () => [
        ...(scroller.current?.querySelectorAll<HTMLElement>(
          '[role="option"]',
        ) ?? []),
      ],
      query: () => latest.current.query,
      sections: () => latest.current.sections,
      pick: (choice) => latest.current.pick(choice),
      close: () => latest.current.close(),
    });
  }, []);

  return (
    <fieldset
      ref={root}
      aria-label={t("emojiPickerLabel")}
      className="min-w-0 border-b bg-popover text-popover-foreground"
    >
      <div className="flex items-center gap-1.5 p-1.5">
        <input
          ref={search}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("emojiSearch")}
          aria-label={t("emojiSearch")}
          className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
        />
        <select
          value={tone}
          onChange={(event) => {
            const value = Number(event.target.value);
            setTone(value);
            storeTone(String(value));
          }}
          aria-label={t("emojiTone")}
          title={t("emojiTone")}
          className="h-8 rounded-md border bg-background px-1 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
        >
          {TONES.map((name, index) => (
            <option key={name} value={index}>
              {`${index === 0 ? "✋" : `✋${String.fromCodePoint(0x1f3fa + index)}`} ${t(`emojiTones.${name}`)}`}
            </option>
          ))}
        </select>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={close}
          aria-label={t("emojiClose")}
          title={t("emojiClose")}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4"
        >
          <X aria-hidden="true" />
        </button>
      </div>
      {!query.trim() && (
        <nav
          aria-label={t("emojiCategories")}
          className="flex gap-0.5 overflow-x-auto px-1.5 pb-1"
        >
          {sections.map((section) => {
            const Icon =
              SECTION_ICONS[section.id as keyof typeof SECTION_ICONS];
            return (
              <button
                key={section.id}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  const box = scroller.current;
                  // The box is the sections' offset parent.
                  const start = box?.querySelector<HTMLElement>(
                    `[data-section="${section.id}"]`,
                  );
                  if (box && start) box.scrollTop = start.offsetTop;
                }}
                aria-label={section.title}
                title={section.title}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4"
              >
                <Icon aria-hidden="true" />
              </button>
            );
          })}
        </nav>
      )}
      <div
        ref={scroller}
        className="relative h-32 overflow-y-auto sm:h-56 overscroll-contain px-1.5 pb-1.5"
      >
        {sections.every((section) => section.choices.length === 0) && (
          <p className="px-1 py-3 text-sm text-muted-foreground">
            {t("emojiNone")}
          </p>
        )}
        {sections.map((section) =>
          section.choices.length === 0 ? null : (
            <section
              key={section.id}
              data-section={section.id}
              className="[content-visibility:auto] [contain-intrinsic-size:auto_10rem]"
            >
              <h3
                id={`${ids}-${section.id}`}
                className="sticky top-0 z-10 bg-popover py-1 text-xs font-medium text-muted-foreground"
              >
                {section.title}
              </h3>
              <div
                role="listbox"
                aria-labelledby={`${ids}-${section.id}`}
                className="grid grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))]"
              >
                {section.choices.map((choice) => (
                  <button
                    key={choice.text}
                    type="button"
                    role="option"
                    aria-selected={false}
                    tabIndex={-1}
                    aria-label={choice.label}
                    title={choice.label}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => pick(choice)}
                    className="inline-flex h-9 items-center justify-center rounded-md text-2xl leading-none outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span aria-hidden="true">{choice.glyph}</span>
                  </button>
                ))}
              </div>
            </section>
          ),
        )}
      </div>
    </fieldset>
  );
}
