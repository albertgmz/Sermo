import { closerFinder, TAG_SOURCE } from "@/components/forum/bb-scan";

// The BB code the web app writes itself, built in this one place: a mention and a quote of a post.

// The name of a member as the renderer reads a mention: plain when it can be, else quoted.
const PLAIN_NAME = /^[\p{L}\p{N}_][\p{L}\p{N}._-]{1,30}[\p{L}\p{N}_]$/u;
export const mentionOf = (username: string) =>
  PLAIN_NAME.test(username) ? `@${username}` : `@"${username}"`;

// The tags whose content is read as it is: a QUOTE tag inside them is no tag.
const LITERAL = new Set(["CODE", "ICODE", "PLAIN"]);

// A tag is made plain text by putting it between PLAIN tags.
const plain = (tag: string) => `[PLAIN]${tag}[/PLAIN]`;

// The text with the QUOTE tags that have no partner made plain text, so that a quoted body can
// neither end its own quote early (a closing tag with no opener) nor swallow the closing tag of
// the quote around it (an opener never closed). Balanced quotes inside it stay quotes.
function balanced(source: string) {
  const find = closerFinder(source);
  const re = new RegExp(TAG_SOURCE, "g");
  const open: { start: number; end: number }[] = [];
  const stray: { start: number; end: number }[] = [];
  for (let m = re.exec(source); m; m = re.exec(source)) {
    const name = m[2].toUpperCase();
    const end = m.index + m[0].length;
    if (m[1] === undefined && LITERAL.has(name)) {
      const closer = find(name, end);
      if (closer >= 0) re.lastIndex = closer + name.length + 3;
    } else if (name === "QUOTE") {
      if (m[1] === undefined) open.push({ start: m.index, end });
      else if (open.length) open.pop();
      else stray.push({ start: m.index, end });
    }
  }
  const edits = [...stray, ...open].sort((a, b) => b.start - a.start);
  let out = source;
  for (const { start, end } of edits) {
    out = out.slice(0, start) + plain(out.slice(start, end)) + out.slice(end);
  }
  return out;
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
