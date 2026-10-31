import { BB_SPOILER_MARK, maskBbCode } from "../../bbcode/mask";

/**
 * The most of a source that is masked when the caller passes a `limit`. Masking costs more than
 * the text is long, so pages built for every guest cut the source first. A spoiler the cut leaves
 * open hides the rest.
 */
export function boundSource(source: string, limit: number): { text: string; truncated: boolean } {
  if (source.length <= limit) return { text: source, truncated: false };
  let text = source.slice(0, limit);
  // A cut inside a tag would leave its start in the text.
  const at = text.lastIndexOf("[");
  if (at >= 0 && text.indexOf("]", at) < 0 && text.length - at <= 210) text = text.slice(0, at);
  return { text, truncated: true };
}

/** Plain text stored when the first post is written: spoilers hidden, BB code tags dropped. */
export function maskMarkupForExcerpt(rawSource: string, limit?: number): string {
  const bounded =
    limit === undefined ? { text: rawSource, truncated: false } : boundSource(rawSource, limit);
  return maskBbCode(bounded.text, bounded.truncated)
    .replace(/\r\n?/g, "\n")
    .replaceAll(BB_SPOILER_MARK, "[spoiler]");
}

export function excerptFromMarkdown(source: string, limit = 200, bound?: number): string {
  const text = maskMarkupForExcerpt(source, bound).replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

/** Headings (`[HEADING=1]` to `[HEADING=3]`) that open a source, with the blank space around them. */
const LEADING_HEADINGS = /^\s*(?:\[HEADING=[1-3]\][\s\S]{0,300}?\[\/HEADING\]\s*)+/i;

/**
 * The excerpt a page description is made of: as `excerptFromMarkdown`, but a heading that opens
 * the source is left out, so the description starts with the text under it. A source made of
 * headings only keeps them.
 */
export function descriptionFromMarkdown(source: string, limit = 200, bound?: number): string {
  const body = source.replace(LEADING_HEADINGS, "");
  return excerptFromMarkdown(body, limit, bound) || excerptFromMarkdown(source, limit, bound);
}
