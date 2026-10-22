import englishCodes from "emojibase-data/en/shortcodes/cldr.json";
import githubCodes from "emojibase-data/en/shortcodes/github.json";
import spanish from "emojibase-data/es/compact.json";
import type { Smilie } from "@/lib/smilies";

// The emoji the composers offer after a ":" (`emoji-suggest.tsx`), from Emojibase's data: the
// emoji and its Spanish name and keywords (CLDR), its GitHub shortcodes (the ones members know from
// other sites, the same as XenForo's for the common ones) and its English CLDR name. This module is
// only loaded once a ":" is typed or the emoji picker is opened: the data is no part of the
// editor's first load. The site's smilies (`:LOL:`, `(y)`) are offered with them.

type Row = {
  hexcode: string;
  label: string;
  unicode: string;
  group?: number;
  order?: number;
  tags?: string[];
  skins?: { unicode: string }[];
};
type Codes = Record<string, string | string[]>;

export type Emoji = {
  emoji: string;
  // The shortcodes, folded (`fold`): GitHub's, then the English name, then the Spanish name.
  codes: string[];
  en: string;
  es: string;
  // The Spanish keywords, folded.
  tags: string[];
  group?: number;
  // The emoji in the five skin tones, light to dark, when it has them.
  skins?: string[];
  // A smilie's codes as they are typed, in the order of `codes` (which are folded).
  smilie?: string[];
};

// A smilie's `code` is the code as it is typed (":LOL:"), an emoji's its shortcode without colons.
export type EmojiHit = {
  emoji: string;
  code: string;
  name: string;
  smilie?: true;
};

// Emojibase's group of skin tones and hair parts, which are not emoji on their own.
const COMPONENTS = 2;
// XenForo offers five.
const LIMIT = 5;

// Lower case without accents, words joined by "_": ":corazon" finds "corazón rojo", and a name
// reads as the shortcode it can be typed as ("cara pensativa" -> "cara_pensativa").
export function fold(text: string) {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+-]+/gu, "_")
    .replace(/^_+|_+$/g, "");
}

const list = (codes: Codes, hexcode: string) => [codes[hexcode] ?? []].flat();

const TONES = ["\u{1F3FB}", "\u{1F3FC}", "\u{1F3FD}", "\u{1F3FE}", "\u{1F3FF}"];
const TONE = /[\u{1F3FB}-\u{1F3FF}]/gu;

// The variants of one tone each (a couple of people takes the one where both have it), light first.
function skinsOf(row: Row) {
  const skins = TONES.map(
    (tone) =>
      row.skins?.find(({ unicode }) => {
        const tones = unicode.match(TONE) ?? [];
        return tones.length > 0 && tones.every((one) => one === tone);
      })?.unicode,
  );
  return skins.every(Boolean) ? (skins as string[]) : undefined;
}

export function emojiIndex(rows: Row[], github: Codes, english: Codes) {
  return rows
    .filter((row) => row.group !== undefined && row.group !== COMPONENTS)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((row): Emoji => {
      const en = list(english, row.hexcode)[0] ?? "";
      return {
        emoji: row.unicode,
        codes: [
          ...new Set([...list(github, row.hexcode), en, row.label].map(fold)),
        ].filter(Boolean),
        en: en.replaceAll("_", " "),
        es: row.label,
        tags: (row.tags ?? []).map(fold),
        group: row.group,
        skins: skinsOf(row),
      };
    });
}

const EMOJI = emojiIndex(
  spanish as Row[],
  githubCodes as Codes,
  englishCodes as Codes,
);

// The ways a shortcode or a keyword can answer what was typed, best first: it starts with it, one
// of its words does, it holds it. Two characters must start a shortcode or one of its words, and
// keywords wait for a third: otherwise emoticons and numbers would open the list (":DD" -> ladder,
// ":30" -> the "1:30" clock), and Enter would pick an emoji instead of starting a line.
const SHORT = 3;
const ANSWERS = [
  (text: string, query: string) => text.startsWith(query),
  (text: string, query: string) => text.includes(`_${query}`),
  (text: string, query: string) => text.includes(query),
];

// How well `emoji` answers `query` (folded), as a rank (lower is better; shortcodes before
// keywords) and the shortcode to show: the shortest that answers as well, or the first when only a
// keyword does.
function answer(
  { codes, tags }: Emoji,
  query: string,
): { rank: number; code: string } | undefined {
  const short = query.length < SHORT;
  // Short: only the first two ways (starts, a word starts).
  const ways = short ? ANSWERS.slice(0, 2) : ANSWERS;
  for (const [rank, answers] of ways.entries()) {
    const code = codes
      .filter((one) => answers(one, query))
      .sort((a, b) => a.length - b.length)[0];
    if (code) return { rank, code };
  }
  if (short) return undefined;
  for (const [rank, answers] of ANSWERS.entries()) {
    if (tags.some((tag) => answers(tag, query))) {
      return { rank: ANSWERS.length + rank, code: codes[0] };
    }
  }
  return undefined;
}

// Emojibase's groups, by number; the third (2) is the skin tones and hair parts.
const GROUP_KEYS = [
  "smileys-emotion",
  "people-body",
  "component",
  "animals-nature",
  "food-drink",
  "travel-places",
  "activities",
  "objects",
  "symbols",
  "flags",
] as const;
export type GroupKey = Exclude<(typeof GROUP_KEYS)[number], "component">;

// Every emoji by group, in Emojibase's order, for the picker.
export function emojiGroups(emoji: Emoji[] = EMOJI) {
  return GROUP_KEYS.flatMap((key, group) => {
    const items = emoji.filter((item) => item.group === group);
    return key !== "component" && items.length > 0
      ? [{ key, emoji: items }]
      : [];
  });
}

const bare = (emoji: string) => emoji.replace(/\uFE0F/g, "");

// The site's smilies as entries of the index, found only by their own codes folded (":LOL:" ->
// "lol"; one of symbols only, such as ">:(", is found by its title) and their title: an emoji's
// own shortcode (":+1", ":thinking") gives the emoji, not a smilie drawn as it.
const smilieIndexes = new WeakMap<Smilie[], Emoji[]>();
function smilieIndex(smilies: Smilie[]) {
  let index = smilieIndexes.get(smilies);
  if (index) return index;
  index = smilies.map((smilie): Emoji => {
    const typed = smilie.codes.filter((code) => fold(code));
    return {
      emoji: smilie.emoji,
      codes: [...new Set([...typed.map(fold), fold(smilie.title)])],
      en: smilie.title,
      es: smilie.title,
      tags: [],
      smilie: typed.length > 0 ? typed : smilie.codes,
    };
  });
  smilieIndexes.set(smilies, index);
  return index;
}

function ranked(
  typed: string,
  locale: string,
  emoji: Emoji[],
  limit = Number.POSITIVE_INFINITY,
): EmojiHit[] {
  const query = fold(typed);
  if (!query) return [];
  const found = emoji.flatMap((item, order) => {
    const answered = answer(item, query);
    return answered ? [{ item, order, ...answered }] : [];
  });
  // When a smilie and the emoji it is drawn as both answer, only the smilie is offered.
  const drawn = new Set(
    found.filter(({ item }) => item.smilie).map(({ item }) => bare(item.emoji)),
  );
  return found
    .filter(({ item }) => item.smilie || !drawn.has(bare(item.emoji)))
    .sort(
      (a, b) =>
        a.rank - b.rank || a.code.length - b.code.length || a.order - b.order,
    )
    .slice(0, limit)
    .map(({ item, code }) =>
      item.smilie
        ? {
            emoji: item.emoji,
            code: item.smilie[item.codes.indexOf(code)] ?? item.smilie[0],
            name: item.es,
            smilie: true as const,
          }
        : {
            emoji: item.emoji,
            code,
            name: locale === "es" ? item.es : item.en,
          },
    );
}

// The emoji and smilies for what was typed after a ":", in XenForo's order: by how well they answer
// it, then the shortest shortcode first, a smilie before an emoji that answers as well. Each comes
// with the shortcode that answers and its name in the page's language (a smilie's title).
export function findEmoji(
  typed: string,
  locale: string,
  emoji: Emoji[] = EMOJI,
  smilies: Smilie[] = [],
): EmojiHit[] {
  return ranked(typed, locale, [...smilieIndex(smilies), ...emoji], LIMIT);
}

// The same for the picker's search box, all of them.
export function searchEmoji(
  typed: string,
  locale: string,
  smilies: Smilie[],
): EmojiHit[] {
  return ranked(typed, locale, [...smilieIndex(smilies), ...EMOJI]);
}

let exact: Map<string, string> | undefined;

// The emoji a whole shortcode stands for (":thinking:", ":cara_pensativa:"), if any.
export function emojiOfCode(code: string) {
  if (!exact) {
    exact = new Map();
    // A shortcode two emoji share stands for the first.
    for (const item of EMOJI) {
      for (const one of item.codes)
        if (!exact.has(one)) exact.set(one, item.emoji);
    }
  }
  return exact.get(fold(code));
}
