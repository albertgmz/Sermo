import englishCodes from "emojibase-data/en/shortcodes/cldr.json";
import githubCodes from "emojibase-data/en/shortcodes/github.json";
import spanish from "emojibase-data/es/compact.json";

// The emoji the composers offer after a ":" (`emoji-suggest.tsx`), from Emojibase's data: the
// emoji and its Spanish name and keywords (CLDR), its GitHub shortcodes (the ones members know from
// other sites, the same as XenForo's for the common ones) and its English CLDR name. This module is
// only loaded once a ":" is typed: the data is no part of the editor's first load.

type Row = {
  hexcode: string;
  label: string;
  unicode: string;
  group?: number;
  tags?: string[];
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
};

export type EmojiHit = { emoji: string; code: string; name: string };

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

export function emojiIndex(rows: Row[], github: Codes, english: Codes) {
  return rows
    .filter((row) => row.group !== undefined && row.group !== COMPONENTS)
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
const WORD_STARTS = 2;
const SHORT = 3;
const ANSWERS = [
  (text: string, query: string) => text.startsWith(query),
  (text: string, query: string) => text.includes(`_${query}`),
  (text: string, query: string) => text.includes(query),
];

// How well `emoji` answers `query` (folded), as a rank (lower is better; shortcodes before
// keywords) and the shortcode to show: the shortest that answers as well, or the first when only a
// keyword does.
function answer({ codes, tags }: Emoji, query: string) {
  const short = query.length < SHORT;
  const ways = short ? ANSWERS.slice(0, WORD_STARTS) : ANSWERS;
  for (const [rank, answers] of ways.entries()) {
    const code = codes
      .filter((one) => answers(one, query))
      .sort((a, b) => a.length - b.length)[0];
    if (code) return { rank, code };
  }
  for (const [rank, answers] of short ? [] : ANSWERS.entries()) {
    if (tags.some((tag) => answers(tag, query))) {
      return { rank: ANSWERS.length + rank, code: codes[0] };
    }
  }
  return undefined;
}

// The emoji for what was typed after a ":", in XenForo's order: by how well they answer it, then
// the shortest shortcode first. Each comes with the shortcode that answers and its name in the
// page's language.
export function findEmoji(
  typed: string,
  locale: string,
  emoji: Emoji[] = EMOJI,
): EmojiHit[] {
  const query = fold(typed);
  if (!query) return [];
  return emoji
    .flatMap((item, order) => {
      const found = answer(item, query);
      return found ? [{ item, order, ...found }] : [];
    })
    .sort(
      (a, b) =>
        a.rank - b.rank || a.code.length - b.code.length || a.order - b.order,
    )
    .slice(0, LIMIT)
    .map(({ item, code }) => ({
      emoji: item.emoji,
      code,
      name: locale === "es" ? item.es : item.en,
    }));
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
