import type { Actor } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { markPublic } from "../../operation";
import { blockedMembers } from "./blocks";

export const quoteBlockSql = {
  /** The posts quoted by a page of content, with their authors (`content_quotes_content_user`). */
  quoted:
    "SELECT content_id, quoted_post_id, quoted_user_id FROM content_quotes WHERE content_type = ?1 AND content_id IN (SELECT value FROM json_each(?2))",
} as const;

const OPEN = /<blockquote\b[^>]*>/g;
const TAG = /<blockquote\b[^>]*>|<\/blockquote>/g;

/** `html` without the quotes of the posts in `postIds`, nested quotes and all. */
export function removeQuotes(html: string, postIds: ReadonlySet<number>): string {
  let result = "";
  let from = 0;
  OPEN.lastIndex = 0;
  for (let open = OPEN.exec(html); open; open = OPEN.exec(html)) {
    const id = /\bdata-post-id="(\d+)"/.exec(open[0])?.[1];
    if (id === undefined || !postIds.has(Number(id))) continue;
    TAG.lastIndex = open.index + open[0].length;
    let depth = 1;
    let end = html.length;
    for (let tag = TAG.exec(html); tag; tag = TAG.exec(html)) {
      depth += tag[0] === "</blockquote>" ? -1 : 1;
      if (depth === 0) {
        end = tag.index + tag[0].length;
        break;
      }
    }
    result += html.slice(from, open.index);
    from = end;
    OPEN.lastIndex = end;
  }
  return from === 0 ? html : result + html.slice(from);
}

/**
 * The bodies of a page of content with the quotes of members in a block with the viewer taken
 * out, for the rows that hold such a quote; the others are absent. One query for the viewer's
 * blocks, and one for the quotes of the page only when the viewer is in a block.
 */
export const bodiesWithoutBlockedQuotes = markPublic(
  "Filters by the blocks of the viewer; the caller decides what content the viewer may see.",
  function bodiesWithoutBlockedQuotes(
    ctx: Ctx,
    actor: Actor,
    contentType: string,
    rows: { id: number; body_html?: string | null }[],
  ): Map<number, string> {
    const result = new Map<number, string>();
    if (rows.length === 0) return result;
    // Most members block nobody: then the quotes are not read at all.
    // In conversations a converted ignore hides nothing, quotes included.
    const blocked = new Set(
      blockedMembers(ctx, actor, contentType === "conversation_message" ? "allHiding" : "all"),
    );
    if (blocked.size === 0) return result;
    const quotes = prepared(ctx, "social.quotedAuthors", () =>
      ctx.sqlite.prepare<
        { content_id: number; quoted_post_id: number; quoted_user_id: number },
        [string, string]
      >(quoteBlockSql.quoted),
    ).all(contentType, JSON.stringify(rows.map((row) => row.id)));
    const hidden = new Map<number, Set<number>>();
    for (const quote of quotes)
      if (blocked.has(quote.quoted_user_id))
        hidden.set(
          quote.content_id,
          (hidden.get(quote.content_id) ?? new Set()).add(quote.quoted_post_id),
        );
    for (const row of rows) {
      const posts = hidden.get(row.id);
      if (posts && row.body_html) result.set(row.id, removeQuotes(row.body_html, posts));
    }
    return result;
  },
);
