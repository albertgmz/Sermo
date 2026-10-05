import { Marked } from "marked";
import sanitizeHtml from "sanitize-html";
import { ValidationError } from "./errors";

/**
 * Markdown -> sanitized HTML: the one function every content type (posts, profile posts,
 * profile post comments, conversation messages) uses at write time; reads serve the stored HTML.
 * Raw HTML in the source is escaped by sanitize-html (shown literally), and the rendered output
 * then passes through sanitize-html with the allowlist below.
 */
const ESCAPE_ALL: sanitizeHtml.IOptions = {
  allowedTags: [],
  allowedAttributes: {},
  disallowedTagsMode: "recursiveEscape",
};

const marked = new Marked({
  gfm: true,
  breaks: true,
  async: false,
  renderer: {
    html({ text }) {
      return sanitizeHtml(text, ESCAPE_ALL);
    },
  },
});

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p",
    "br",
    "hr",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "blockquote",
    "pre",
    "code",
    "ul",
    "ol",
    "li",
    "strong",
    "em",
    "del",
    "a",
    "img",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "input",
  ],
  allowedAttributes: {
    a: ["href", "title", "rel"],
    img: ["src", "alt", "title"],
    ol: ["start"],
    th: ["align"],
    td: ["align"],
    input: [
      { name: "type", values: ["checkbox"] },
      { name: "checked", values: ["", "checked"] },
      { name: "disabled", values: ["", "disabled"] },
    ],
  },
  allowedClasses: { code: ["language-*"] },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: ["http", "https"] },
  allowProtocolRelative: false,
  disallowedTagsMode: "escape",
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "nofollow ugc noopener" }),
  },
};

/**
 * Rendering cost grows faster than linearly on adversarial input; at 10,000 characters the
 * worst cases measured stay around 45 ms. Deep quote nesting overflows the parser's stack.
 */
export const MAX_BODY_LENGTH = 10_000;
const MAX_QUOTE_DEPTH = 10;
const TOO_DEEP_QUOTES = new RegExp(`^(?:[ \t]{0,3}>){${MAX_QUOTE_DEPTH + 1}}`, "m");

/** Throws ValidationError for input that cannot be rendered safely. */
export function renderMarkdown(source: string): string {
  if (TOO_DEEP_QUOTES.test(source)) {
    throw new ValidationError("Quotes are nested too deeply.", [
      { path: ["body"], message: `Quotes may be nested at most ${MAX_QUOTE_DEPTH} levels deep.` },
    ]);
  }
  let html: string;
  try {
    html = marked.parse(source) as string;
  } catch (error) {
    if (error instanceof RangeError) {
      throw new ValidationError("The text is too complex to display.", [
        { path: ["body"], message: "The text is too complex to display." },
      ]);
    }
    throw error;
  }
  return sanitizeHtml(html, SANITIZE_OPTIONS).trim();
}
