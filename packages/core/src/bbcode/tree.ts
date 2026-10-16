import { ValidationError } from "../errors";
import type { Deadline } from "./deadline";
import { HASHTAG_SOURCE, normalizeTag } from "./hashtag";
import { ADDRESS_CHAR, STRAY_HR, type Tok, URL_PATTERN } from "./scan";

const MAX_QUOTE_DEPTH = 10;
const MAX_SPOILER_DEPTH = 10;
/** Containers inside containers, of any kind. */
const MAX_NESTING = 30;

/** A quote's data; a `post` reference is resolved against the database by the caller. */
export interface Quote {
  author: string | null;
  postId: number | null;
  resolvedAuthor?: string;
  userId?: number;
}

export interface El {
  t: "el";
  name: string;
  option?: string;
  kids: Node[];
  /** The source range of the opening tag. */
  start: number;
  end: number;
  /** Some descendant is a block, so this inline tag is drawn on its own, not inside a paragraph. */
  hasBlock: boolean;
  quote?: Quote;
}

export interface MentionNode {
  t: "mention";
  /** The name to look up, or the label of a `[USER=id]` tag. */
  name: string;
  /** What shows when nobody resolves. */
  fallback: string;
  hint: number | null;
  userId?: number;
  displayName?: string;
}

/** A `#tag` in the text. `link` is the tag it reaches once resolved (null: shown as typed). */
export interface HashtagNode {
  t: "hashtag";
  /** The key of the tag. */
  tag: string;
  /** As typed, with the `#`. */
  text: string;
  link: string | null;
  /** In a spoiler or a quote: it may link where it is, but never tags the thread. */
  hidden: boolean;
}

export type Node =
  | { t: "text"; text: string }
  | { t: "link"; href: string; text: string }
  | MentionNode
  | HashtagNode
  | { t: "atom"; tok: Tok; inline: boolean }
  | El;

export interface Tree {
  kids: Node[];
  mentions: MentionNode[];
  /** The hashtags, in source order. */
  hashtags: HashtagNode[];
  /** The quotes that name a post, in source order. */
  quotes: El[];
}

const STRUCTURE = new Set(["*", "TR", "TH", "TD"]);
const BLOCK_ELEMENTS = new Set([
  "LEFT",
  "CENTER",
  "RIGHT",
  "JUSTIFY",
  "INDENT",
  "QUOTE",
  "SPOILER",
  "LIST",
  "TABLE",
  "HEADING",
  "CODE",
]);

export function isBlock(node: Node): boolean {
  if (node.t === "el") return BLOCK_ELEMENTS.has(node.name) || node.hasBlock;
  if (node.t !== "atom") return false;
  const { name, text } = node.tok;
  return (
    name === "CODE" || name === "HR" || (name === "PLAIN" && !node.inline && text!.includes("\n\n"))
  );
}

const tooDeep = (limit: number) =>
  new ValidationError("Containers are nested too deeply.", [
    { path: ["body"], message: `Containers may be nested at most ${limit} levels deep.` },
  ]);

/**
 * What the text between tags can hold besides text: a bare address (http, https or www) becomes a
 * link, `@name` or `@"two words"` a mention and `#tag` a hashtag. One pass, every part bounded.
 */
const INLINE_MARKS = new RegExp(
  `(?<![\\p{L}\\p{N}_])(?:https?:\\/\\/|www\\.)${ADDRESS_CHAR}+|(?<=^|[\\s\\p{P}])@(?:"([\\p{L}\\p{N}_][\\p{L}\\p{N} ._-]{1,30}[\\p{L}\\p{N}_])"|([\\p{L}\\p{N}_][\\p{L}\\p{N}._-]{1,30}[\\p{L}\\p{N}_]))(?![\\p{L}\\p{N}_-])|${HASHTAG_SOURCE}`,
  "giu",
);

/** The address without the punctuation a sentence puts after it. */
function trimAddress(address: string): string {
  let end = address.length;
  let opening = 0;
  let closing = 0;
  for (let i = 0; i < end; i++) {
    const code = address.charCodeAt(i);
    if (code === 40) opening++;
    else if (code === 41) closing++;
  }
  while (end > 0) {
    const character = address[end - 1]!;
    if (".,;:!?*".includes(character)) end--;
    else if (character === ")" && closing > opening) {
      closing--;
      end--;
    } else break;
  }
  return address.slice(0, end);
}

/** The `key: N` pairs a quote option ends with, as XenForo writes them (`post: 5, member: 2`). */
const QUOTE_PAIRS =
  /(?:^|,)\s*[A-Za-z_]\w{0,30}\s*:\s*\d{1,12}(?:\s*,\s*[A-Za-z_]\w{0,30}\s*:\s*\d{1,12})*\s*$/;

/** The post named by a run of `key: N` pairs; every other key is ignored. */
function quotedPost(pairs: string): number | null {
  for (const part of pairs.split(",")) {
    const found = /^\s*post\s*:\s*(\d+)\s*$/i.exec(part);
    if (found) return Number(found[1]) || null;
  }
  return null;
}

interface Frame {
  el: El | null;
  kids: Node[];
  depth: number;
  quotes: number;
  spoilers: number;
  inLink: boolean;
  rich: boolean;
  pending: string;
}

export function build(source: string, toks: Tok[], deadline: Deadline): Tree {
  const mentions: MentionNode[] = [];
  const hashtags: HashtagNode[] = [];
  const quotes: El[] = [];
  const root: Frame = {
    el: null,
    kids: [],
    depth: 0,
    quotes: 0,
    spoilers: 0,
    inLink: false,
    rich: false,
    pending: "",
  };
  const stack: Frame[] = [root];

  const splitText = (frame: Frame, text: string): void => {
    if (frame.rich || !/[@#]|http|www\./i.test(text)) {
      frame.kids.push({ t: "text", text });
      return;
    }
    let last = 0;
    INLINE_MARKS.lastIndex = 0;
    for (let found = INLINE_MARKS.exec(text); found; found = INLINE_MARKS.exec(text)) {
      deadline.tick();
      if (frame.inLink) continue;
      const from = found.index;
      if (found[0][0] === "#") {
        const tag = normalizeTag(found[3]!);
        if (!tag) continue;
        if (from > last) frame.kids.push({ t: "text", text: text.slice(last, from) });
        const hashtag: HashtagNode = {
          t: "hashtag",
          tag,
          text: found[0],
          link: null,
          hidden: frame.spoilers > 0 || frame.quotes > 0,
        };
        hashtags.push(hashtag);
        frame.kids.push(hashtag);
        last = from + found[0].length;
        continue;
      }
      if (found[0][0] === "@") {
        if (from > last) frame.kids.push({ t: "text", text: text.slice(last, from) });
        const mention: MentionNode = {
          t: "mention",
          name: found[1] ?? found[2]!,
          fallback: found[0],
          hint: null,
        };
        mentions.push(mention);
        frame.kids.push(mention);
        last = from + found[0].length;
        continue;
      }
      const address = trimAddress(found[0]);
      const href = /^www\./i.test(address) ? `https://${address}` : address;
      if (!URL_PATTERN.test(href)) continue;
      if (from > last) frame.kids.push({ t: "text", text: text.slice(last, from) });
      frame.kids.push({ t: "link", href, text: address });
      last = from + address.length;
      INLINE_MARKS.lastIndex = last;
    }
    if (last < text.length) frame.kids.push({ t: "text", text: text.slice(last) });
  };

  const flush = (frame: Frame): void => {
    if (!frame.pending) return;
    const text = frame.pending;
    frame.pending = "";
    splitText(frame, text);
  };

  const closeFrame = (closer?: Tok): void => {
    const frame = stack.pop()!;
    flush(frame);
    const parent = stack[stack.length - 1]!;
    flush(parent);
    const el = frame.el!;
    if (el.name === "TABLE" && !el.kids.some((kid) => kid.t === "el" && kid.name === "TR")) {
      // A table without a row is not one: it stays as typed.
      parent.kids.push({ t: "text", text: source.slice(el.start, el.end) }, ...el.kids);
      if (closer) parent.kids.push({ t: "text", text: source.slice(closer.start, closer.end) });
      return;
    }
    el.hasBlock = !BLOCK_ELEMENTS.has(el.name) && el.kids.some(isBlock);
    parent.kids.push(el);
  };

  const openFrame = (tok: Tok): void => {
    const parent = stack[stack.length - 1]!;
    flush(parent);
    const depth = parent.depth + (STRUCTURE.has(tok.name) ? 0 : 1);
    const quote = tok.name === "QUOTE";
    const spoiler = tok.name === "SPOILER" || tok.name === "ISPOILER";
    const quoteDepth = parent.quotes + Number(quote);
    const spoilerDepth = parent.spoilers + Number(spoiler);
    if (depth > MAX_NESTING) throw tooDeep(MAX_NESTING);
    if (quoteDepth > MAX_QUOTE_DEPTH || spoilerDepth > MAX_SPOILER_DEPTH)
      throw tooDeep(MAX_QUOTE_DEPTH);
    const el: El = {
      t: "el",
      name: tok.name,
      option: tok.option,
      kids: [],
      start: tok.start,
      end: tok.end,
      hasBlock: false,
    };
    if (quote) {
      const option = tok.option ?? "";
      const reference = QUOTE_PAIRS.exec(option);
      const postId = reference ? quotedPost(reference[0]) : null;
      const author = (reference ? option.slice(0, reference.index) : option).trim();
      el.quote = { author: author || null, postId: postId && postId > 0 ? postId : null };
      if (el.quote.postId) quotes.push(el);
    }
    stack.push({
      el,
      kids: el.kids,
      depth,
      quotes: quoteDepth,
      spoilers: spoilerDepth,
      inLink: parent.inLink || tok.name === "URL" || tok.name === "EMAIL",
      rich:
        parent.rich ||
        ((tok.name === "CODE" || tok.name === "ICODE") && tok.option?.toLowerCase() === "rich"),
      pending: "",
    });
  };

  let position = 0;
  for (const tok of toks) {
    deadline.tick();
    const top = stack[stack.length - 1]!;
    if (tok.start > position) top.pending += source.slice(position, tok.start);
    position = tok.end;
    if (!tok.live) {
      top.pending += source.slice(tok.start, tok.end);
    } else if (tok.kind === "open") {
      if (tok.name === "*" && top.el?.name === "*") closeFrame();
      openFrame(tok);
    } else if (tok.kind === "close") {
      if (tok.name === "LIST" && top.el?.name === "*") closeFrame();
      closeFrame(tok);
    } else {
      flush(top);
      if (tok.name === "USER" && !top.inLink && !top.rich) {
        const mention: MentionNode = {
          t: "mention",
          name: tok.text!,
          fallback: tok.text!,
          hint: Number(tok.id),
        };
        mentions.push(mention);
        top.kids.push(mention);
      } else if (tok.name === STRAY_HR && !top.rich) {
        // Nothing to draw.
      } else if (
        tok.name === "USER" ||
        (top.rich && (tok.name === "CODE" || tok.name === "HR" || tok.name === STRAY_HR))
      ) {
        top.kids.push({
          t: "text",
          text: tok.name === "USER" ? tok.text! : source.slice(tok.start, tok.end),
        });
      } else {
        top.kids.push({ t: "atom", tok, inline: top.rich });
      }
    }
  }
  if (position < source.length) root.pending += source.slice(position);
  flush(root);
  return { kids: root.kids, mentions, hashtags, quotes };
}
