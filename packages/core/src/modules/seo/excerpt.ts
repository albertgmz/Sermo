import { BB_SPOILER_MARK, maskBbCode } from "../../markdown/bbcode";

/**
 * The most of a source that is masked when the caller passes a `limit`. Masking costs more than
 * the text is long, so pages built for every guest cut the source first. A spoiler the cut leaves
 * open hides the rest, and so does an inline marker.
 */
export function boundSource(source: string, limit: number): { text: string; truncated: boolean } {
  if (source.length <= limit) return { text: source, truncated: false };
  let text = source.slice(0, limit);
  const marker = text.lastIndexOf(">!");
  if (marker >= 0 && text.indexOf("!<", marker + 2) < 0) text = text.slice(0, marker);
  return { text, truncated: true };
}

/** Plain text stored when the first post is written. */
export function maskMarkupForExcerpt(rawSource: string, limit?: number): string {
  const bounded =
    limit === undefined ? { text: rawSource, truncated: false } : boundSource(rawSource, limit);
  const source = maskBbCode(bounded.text, bounded.truncated);
  const output: string[] = [];
  const containers: ("quote" | "spoiler")[] = [];
  let fence: string | null = null;
  for (const line of source.replace(/\r\n?/g, "\n").split("\n")) {
    const text = line.replace(/^\s*(?:(?:>\s*)|(?:(?:[-*+]|\d+\.)\s+))*/, "");
    const marker = /^(`{3,}|~{3,})/.exec(text)?.[1];
    if (marker) {
      if (!fence) fence = marker[0]!;
      else if (marker[0] === fence && marker.length >= 3) fence = null;
    }
    if (!fence && !marker) {
      const open = /^:::(quote|spoiler)(?:\{[^\n}]*\})?\s*$/.exec(text);
      if (open) {
        if (open[1] === "spoiler" && !containers.includes("spoiler")) output.push("[spoiler]");
        containers.push(open[1] as "quote" | "spoiler");
        continue;
      }
      if (/^:::\s*$/.test(text) && containers.length) {
        containers.pop();
        continue;
      }
    }
    if (!containers.includes("spoiler")) output.push(line.replace(/>![^\n]*?!</g, "[spoiler]"));
  }
  return output.join("\n").replaceAll(BB_SPOILER_MARK, "[spoiler]");
}

export function excerptFromMarkdown(source: string, limit = 200, bound?: number): string {
  const text = maskMarkupForExcerpt(source, bound)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/[`*_~>#|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}
