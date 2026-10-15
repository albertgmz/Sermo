import { Deadline } from "./deadline";
import { lex, pair } from "./scan";

const NO_LIMIT = Number.POSITIVE_INFINITY;

const TAG_NAMES = [
  "B",
  "I",
  "U",
  "S",
  "COLOR",
  "FONT",
  "SIZE",
  "URL",
  "EMAIL",
  "USER",
  "IMG",
  "MEDIA",
  "ICODE",
  "PLAIN",
  "ATTACH",
  "ISPOILER",
  "LEFT",
  "CENTER",
  "RIGHT",
  "QUOTE",
  "SPOILER",
  "CODE",
  "INDENT",
  "LIST",
  "TABLE",
  "HEADING",
  "TR",
  "TH",
  "TD",
  "HR",
  String.raw`\*`,
];
const ANY_TAG = new RegExp(String.raw`\[\/?(?:${TAG_NAMES.join("|")})(?:=[^\]\n]{0,200})?\]`, "gi");
const SPOILER_MARK = "\u0001";

/**
 * Plain-text paths that work from the source (excerpts, search snippets) show `[spoiler]` for
 * spoilers and drop the other tags. Spoilers are found with the pairing the renderer uses, so the
 * text it hides is the text hidden here. `truncated` says the text was cut: a spoiler left open
 * may have ended past the cut, so it hides the rest.
 */
export function maskBbCode(source: string, truncated = false): string {
  if (!source.includes("[")) return source;
  const deadline = new Deadline(NO_LIMIT);
  const toks = lex(source, deadline);
  pair(toks, deadline);
  let masked = "";
  let from = 0;
  let start = 0;
  let depth = 0;
  for (const tok of toks) {
    if (tok.kind === "atom" || (tok.name !== "SPOILER" && tok.name !== "ISPOILER")) continue;
    if (tok.kind === "open") {
      if (tok.live) {
        if (depth === 0) start = tok.start;
        depth++;
      } else if (truncated && depth === 0) {
        masked += source.slice(from, tok.start) + SPOILER_MARK;
        from = source.length;
        break;
      }
    } else if (tok.live && --depth === 0) {
      masked += source.slice(from, start) + SPOILER_MARK;
      from = tok.end;
    }
  }
  masked += source.slice(from);
  return masked.replace(ANY_TAG, "");
}

/** The mark `maskBbCode` leaves where a spoiler was; callers turn it into `[spoiler]`. */
export const BB_SPOILER_MARK = SPOILER_MARK;
