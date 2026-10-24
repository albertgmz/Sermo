import { postQuoteStart } from "./html";

/** How a stored quote of a post began while its header was written in English ("Alice wrote:"). */
export const LEGACY_POST_QUOTE = '<blockquote class="quote" data-post-id="';

/**
 * That old start in full: the post's id, then its author, linked to the post (the sanitizer added
 * `rel`) or, inside a link, only named. A name is escaped, so it holds no `<`.
 */
const LEGACY_START =
  /<blockquote class="quote" data-post-id="(\d+)"><cite>([^<]*|<a [^>]*>[^<]*<\/a>) wrote:<\/cite>/g;

/** Stored HTML with every quote of a post given the header a render writes now; the rest as it was. */
export function upgradePostQuotes(html: string): string {
  return html.replace(LEGACY_START, (_whole, postId: string, author: string) =>
    postQuoteStart(postId, author),
  );
}
