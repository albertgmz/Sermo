import { TAG_SOURCE, tagOf } from "@/components/forum/bb-scan";

// What the editor shows of a quote it holds as BB code (`[QUOTE]...[/QUOTE]`, with or without the
// option XenForo writes: `[QUOTE="Name, post: 12, member: 3"]`): who is quoted, the post or
// conversation message the quote names, and the text between the tags.

// The `key: N` pairs an option ends with, kept equal to the backend's reading
// (packages/core/src/bbcode/tree.ts). A name comes before them.
const PAIRS =
  /(?:,|^(?=\s*(?:post|member|convMessage)\s*:))\s*[A-Za-z_]\w{0,30}\s*:\s*\d{1,12}(?:\s*,\s*[A-Za-z_]\w{0,30}\s*:\s*\d{1,12})*\s*$/i;
const OPENING = new RegExp(`^${TAG_SOURCE}`);
const CLOSING = "[/QUOTE]";

export type QuoteParts = {
  author: string | null;
  // The address of the post or message the quote names.
  href: string | null;
  // The text between the tags.
  inner: string;
};

// The parts of `raw`, which is a whole quote from its opening tag to its closing one.
export function quoteParts(raw: string): QuoteParts {
  const open = OPENING.exec(raw);
  const option = (open && tagOf(open)?.option) ?? "";
  const pairs = PAIRS.exec(option);
  let href: string | null = null;
  // The last pair that names a post or a message counts.
  for (const part of pairs?.[0].split(",") ?? []) {
    const pair = /^\s*(post|convMessage)\s*:\s*(\d+)\s*$/i.exec(part);
    const id = Number(pair?.[2]);
    if (!pair || !id) continue;
    href =
      pair[1].toLowerCase() === "post"
        ? `/posts/${id}`
        : `/conversations/messages/${id}`;
  }
  const author = (pairs ? option.slice(0, pairs.index) : option).trim();
  return {
    author: author || null,
    href,
    inner: raw.slice(open?.[0].length ?? 0, raw.length - CLOSING.length),
  };
}
