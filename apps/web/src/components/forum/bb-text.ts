import {
  closerFinder,
  literalContentOk,
  readsLiterally,
  TAG_SOURCE,
  tagOf,
} from "@/components/forum/bb-scan";

// The BB code the web app writes itself, built in this one place: a mention and a quote of a post.

// The name of a member as the renderer reads a mention: plain when it can be, else quoted.
const PLAIN_NAME = /^[\p{L}\p{N}_][\p{L}\p{N}._-]{1,30}[\p{L}\p{N}_]$/u;
export const mentionOf = (username: string) =>
  PLAIN_NAME.test(username) ? `@${username}` : `@"${username}"`;

// A tag is made plain text by putting it between PLAIN tags.
const plain = (tag: string) => `[PLAIN]${tag}[/PLAIN]`;

type Range = { start: number; end: number };

// The tags that pair with a closing tag of their name. A closing tag in the body with no opener in
// the body would pair with one written before the quote and leave the quote's own opener as text.
const PAIRED = new Set([
  "B",
  "I",
  "U",
  "S",
  "URL",
  "EMAIL",
  "COLOR",
  "FONT",
  "SIZE",
  "ISPOILER",
  "SPOILER",
  "LEFT",
  "CENTER",
  "RIGHT",
  "INDENT",
  "LIST",
  "TABLE",
  "HEADING",
  "TR",
  "TH",
  "TD",
]);

// The text with the tags that would reach outside the quote made plain text: the QUOTE tags that
// have no partner, so that a quoted body can neither end its own quote early (a closing tag with no
// opener) nor swallow the closing tag of the quote around it (an opener never closed), and the
// tags that read their content as it is (code, plain text, a picture, a link...) and have no
// closing tag in the body, which would find one in what is written after the quote, and the
// closing tags (of a format, a link, a list...) with no opener in the body, which would pair with
// one written before the quote. What such a
// tag holds is not read, so a QUOTE tag in it is left alone. Balanced quotes stay quotes.
function balanced(source: string) {
  const find = closerFinder(source);
  const re = new RegExp(TAG_SOURCE, "g");
  const open: Range[] = [];
  const edits: Range[] = [];
  const opened = new Map<string, number>();
  for (let m = re.exec(source); m; m = re.exec(source)) {
    const tag = tagOf(m);
    if (!tag) {
      re.lastIndex = m.index + 1;
      continue;
    }
    const range = { start: m.index, end: m.index + m[0].length };
    if (!tag.closing && readsLiterally(tag.name, tag.option)) {
      const closer = find(tag.name, range.end);
      if (closer < 0) {
        edits.push(range);
      } else if (
        // What the renderer takes as a player is checked for its site, which is not done here: what
        // is in a player tag is read like the rest (a valid one holds no tag).
        tag.name !== "MEDIA" &&
        literalContentOk(tag.name, source.slice(range.end, closer))
      ) {
        re.lastIndex = closer + tag.name.length + 3;
      }
    } else if (tag.name === "QUOTE") {
      if (!tag.closing) open.push(range);
      else if (open.length) open.pop();
      else edits.push(range);
    } else if (PAIRED.has(tag.name)) {
      const count = opened.get(tag.name) ?? 0;
      if (!tag.closing) opened.set(tag.name, count + 1);
      else if (count > 0) opened.set(tag.name, count - 1);
      else edits.push(range);
    }
  }
  const wrapped = [...edits, ...open].sort((x, y) => x.start - y.start);
  let out = "";
  let at = 0;
  for (const { start, end } of wrapped) {
    out += source.slice(at, start) + plain(source.slice(start, end));
    at = end;
  }
  return out + source.slice(at);
}

// A post quoted as the renderer reads it: the author's name, the post and the member, in the form
// the renderer itself writes back when it saves. It fills in the name from the member, so a name
// the tag cannot hold costs nothing.
export function quoteOf(
  postId: number,
  author: string,
  authorId: number,
  source: string,
) {
  const name = author.replace(/["[\],\s]+/g, " ").trim() || "member";
  return `[QUOTE="${name}, post: ${postId}, member: ${authorId}"]${balanced(source.trim())}[/QUOTE]`;
}
