/** The longest tag, in characters (after normalising). */
export const MAX_TAG_LENGTH = 50;

/** What a tag is made of: letters, combining marks (decomposed accents), numbers and `_`. */
const TAG_CHARS = "\\p{L}\\p{M}\\p{N}_";

/**
 * A hashtag inside the text between tags: `#` and 1-50 tag characters, not preceded by a letter,
 * number or `&` or `/` (so `a#b`, `&#123;` and the fragment of an address are not tags) and not
 * followed by one more tag character (a longer word is not a tag). Whether it holds a letter is
 * checked by `normalizeTag`. Spliced into the inline-marks expression of the tree builder.
 */
export const HASHTAG_SOURCE = `(?<![\\p{L}\\p{M}\\p{N}&/])#([${TAG_CHARS}]{1,${MAX_TAG_LENGTH}})(?![${TAG_CHARS}])`;

const TAG_NAME = new RegExp(`^[${TAG_CHARS}]+$`, "u");
const HAS_LETTER = /\p{L}/u;

/**
 * The key of a tag, or null when the text is not a tag name: NFC and lowercase, only tag
 * characters, at least one letter, at most 50 characters. A leading `#` is accepted.
 */
export function normalizeTag(raw: string): string | null {
  const name = (raw.startsWith("#") ? raw.slice(1) : raw)
    .normalize("NFC")
    .toLowerCase()
    .normalize("NFC");
  if (!TAG_NAME.test(name) || !HAS_LETTER.test(name)) return null;
  return [...name].length <= MAX_TAG_LENGTH ? name : null;
}
