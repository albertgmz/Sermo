import { Deadline } from "./deadline";
import { lex, pair, type Tok } from "./scan";

const NO_LIMIT = Number.POSITIVE_INFINITY;
const SPOILER_MARK = "\u0001";

/** What a tag with content of its own leaves in a plain text: the text, or nothing. */
function atomText(tok: Tok, source: string): string {
  switch (tok.name) {
    case "CODE":
    case "ICODE":
    case "PLAIN":
    case "USER":
      return tok.text ?? "";
    case "EMAIL":
    case "URL":
      return tok.text ?? tok.href ?? "";
    case "IMG":
    case "MEDIA":
    case "ATTACH":
    case "HR":
      return "";
    default:
      return source.slice(tok.start, tok.end);
  }
}

/**
 * The text of a source as a reader would see it, without the tags: the tokens the renderer reads
 * decide what a tag is, so `arr[i]` stays and an unpaired tag stays as typed. Pictures, players
 * and attachments leave nothing. With `spoilers: "mask"` each spoiler becomes one mark (`truncated`
 * says the text was cut, so a spoiler left open hides the rest); with `"keep"` their text stays
 * (the search index finds words inside spoilers).
 */
function plainText(raw: string, spoilers: "mask" | "keep", truncated: boolean): string {
  // A typed U+0001 must not read as the mark of a spoiler.
  const source = raw.replace(/\r\n?/g, "\n").replaceAll(SPOILER_MARK, "");
  if (!source.includes("[")) return source;
  const deadline = new Deadline(NO_LIMIT);
  const toks = lex(source, deadline);
  pair(toks, deadline);
  let out = "";
  let position = 0;
  let depth = 0;
  for (const tok of toks) {
    if (tok.start > position && depth === 0) out += source.slice(position, tok.start);
    position = tok.end;
    const spoiler = tok.name === "SPOILER" || tok.name === "ISPOILER";
    if (spoiler && tok.kind !== "atom" && spoilers === "mask") {
      if (!tok.live) {
        // A spoiler the cut left open may have ended past it.
        if (truncated && depth === 0 && tok.kind === "open") {
          out += SPOILER_MARK;
          return out;
        }
      } else if (tok.kind === "open") {
        if (depth === 0) out += SPOILER_MARK;
        depth++;
        continue;
      } else {
        depth--;
        continue;
      }
    }
    if (depth > 0) continue;
    if (tok.kind === "atom") out += atomText(tok, source);
    else if (!tok.live) out += source.slice(tok.start, tok.end);
  }
  if (depth === 0) out += source.slice(position);
  return out;
}

/** Plain text for excerpts and snippets: spoilers masked with `BB_SPOILER_MARK`. */
export function maskBbCode(source: string, truncated = false): string {
  return plainText(source, "mask", truncated);
}

/** Plain text for the search index: words inside spoilers are kept. */
export function bbCodeText(source: string): string {
  return plainText(source, "keep", false);
}

/** The mark `maskBbCode` leaves where a spoiler was; callers turn it into `[spoiler]`. */
export const BB_SPOILER_MARK = SPOILER_MARK;
