/** The longest tag, in characters (after normalising). */
export const MAX_TAG_LENGTH = 50;

/** What a tag is made of: letters, combining marks (decomposed accents), numbers and `_`. */
const TAG_CHARS = "\\p{L}\\p{M}\\p{N}_";

/**
 * A hashtag inside the text between tags: `#` and 1-50 tag characters, not preceded by a letter,
 * number, `&`, `/`, `=` or `#` (so `##x`, which Markdown writers mean as a heading, is text; so `a#b`, `&#123;`, the fragment of an address and the colour of an
 * unclosed `[COLOR=#ff0000]` are not tags) and not
 * followed by one more tag character (a longer word is not a tag). Whether it holds a letter is
 * checked by `normalizeTag`. Spliced into the inline-marks expression of the tree builder.
 */
export const HASHTAG_SOURCE = `(?<![\\p{L}\\p{M}\\p{N}&/=#])#([\\p{L}\\p{N}_][${TAG_CHARS}]{0,${MAX_TAG_LENGTH - 1}})(?![${TAG_CHARS}])`;

// A name starts with a letter, a number or `_`: a leading combining mark would draw on the `#`.
const TAG_NAME = new RegExp(`^[\\p{L}\\p{N}_][${TAG_CHARS}]*$`, "u");
// A letter that shows: the fillers (Hangul fillers) are letters of category Lo that draw nothing.
const HAS_LETTER = /(?![\u115F\u1160\u3164\uFFA0])\p{L}/u;

/**
 * The text of a name as a key is spelled: NFC and lowercase, a Greek final sigma folded to `σ`,
 * and the characters that draw nothing (variation selectors, joiners, the combining grapheme
 * joiner, the Hangul fillers: the Default_Ignorable_Code_Point property) taken out, so `a` and
 * `a` with a variation selector are one tag. A combining mark that composes with its letter is
 * the single letter after NFC; one that does not stays. The one place a name is folded: the
 * recognition, the lookup of a typed name, the admin screens and the web all call it.
 */
export function foldTagText(raw: string): string {
  return raw
    .normalize("NFC")
    .toLowerCase()
    .replaceAll("ς", "σ")
    .replace(/\p{Default_Ignorable_Code_Point}/gu, "")
    .normalize("NFC");
}

/**
 * The key of a tag, or null when the text is not a tag name: folded by `foldTagText`, only tag
 * characters, at least one letter that draws something, at most 50 characters. A leading `#`
 * is accepted.
 */
export function normalizeTag(raw: string): string | null {
  const name = foldTagText(raw.startsWith("#") ? raw.slice(1) : raw);
  if (!TAG_NAME.test(name) || !HAS_LETTER.test(name)) return null;
  return [...name].length <= MAX_TAG_LENGTH ? name : null;
}
