import { Marked, type Token } from "marked";
import sanitizeHtml from "sanitize-html";
import { ValidationError } from "../../errors";
import { renderMarkdown } from "../../render";

/** What a signature may hold once rendered: one paragraph of text, emphasis, code and links. */
const ALLOWED_TAGS = new Set(["p", "br", "a", "strong", "em", "del", "s", "code"]);
const MESSAGE =
  "A signature is one short block of text: emphasis, strikethrough, inline code, links and line breaks only.";

const refuse = (): never => {
  throw new ValidationError(MESSAGE, [{ path: ["signature"], message: MESSAGE }]);
};

function hasRawHtml(tokens: Token[]): boolean {
  return tokens.some((token) => {
    const children = (token as { tokens?: Token[]; items?: Token[] }).tokens ?? [];
    const items = (token as { items?: Token[] }).items ?? [];
    return token.type === "html" || hasRawHtml(children) || hasRawHtml(items);
  });
}

/**
 * The HTML of a signature. The renderer turns raw HTML into literal text, so a signature that
 * holds some is refused from the Markdown's own tokens; everything else is judged on the
 * rendered HTML, read with the sanitiser's parser: every element must be one a signature may
 * hold and there must be exactly one paragraph. Mentions stay plain text (nothing resolves
 * them here).
 */
export function renderSignature(source: string): string {
  if (hasRawHtml(new Marked({ gfm: true, breaks: true }).lexer(source))) refuse();
  const html = renderMarkdown(source);
  const seen: string[] = [];
  sanitizeHtml(html, {
    allowedTags: [],
    allowedAttributes: {},
    transformTags: {
      "*": (tagName, attribs) => {
        seen.push(tagName);
        return { tagName, attribs };
      },
    },
  });
  if (seen.some((tag) => !ALLOWED_TAGS.has(tag)) || seen.filter((tag) => tag === "p").length !== 1)
    refuse();
  return html;
}
