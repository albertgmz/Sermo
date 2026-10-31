// The public pages that hold fixed text: their text must be in the first HTML, visible to a reader
// that runs no JavaScript (a crawler, a policy checker). Pages written under `/pages/<slug>` are
// checked by their own address. tests/public-pages-html.test.ts keeps this list and the routes in
// step.
export const PUBLIC_TEXT_PATHS = [
  "/privacy",
  "/terms",
  "/legal",
  "/rules",
  "/contact",
  "/cookies",
] as const;

// Below this many characters beside the heading, the article holds no real text: the loading
// skeleton has none, a page has at least its date line and its text.
const MIN_TEXT = 40;

const STREAMED_BLOCK = /<div hidden id="S:[^"]*">/g;
const DIV_TAG = /<\/?div\b[^>]*>/gi;

// Where the `<div>` that opens at `start` closes (after its `</div>`), counting the divs inside it.
function endOfDiv(html: string, start: number): number {
  DIV_TAG.lastIndex = start;
  let depth = 0;
  for (let tag = DIV_TAG.exec(html); tag; tag = DIV_TAG.exec(html)) {
    depth += tag[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return tag.index + tag[0].length;
  }
  return html.length;
}

// The HTML without the blocks React streams after the shell (`<div hidden id="S:n">`, moved into
// place by a script): what a reader without JavaScript does not see.
export function withoutStreamedBlocks(html: string): string {
  let shown = "";
  let from = 0;
  for (;;) {
    STREAMED_BLOCK.lastIndex = from;
    const block = STREAMED_BLOCK.exec(html);
    if (!block) return shown + html.slice(from);
    shown += html.slice(from, block.index);
    from = endOfDiv(html, block.index);
  }
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity, name: string) => {
      if (name.startsWith("#x"))
        return String.fromCodePoint(Number.parseInt(name.slice(2), 16));
      if (name.startsWith("#"))
        return String.fromCodePoint(Number(name.slice(1)));
      return ENTITIES[name.toLowerCase()] ?? entity;
    })
    .replace(/\s+/g, " ")
    .trim();
}

// The heading and the text of the first `<article>` a reader without JavaScript sees, or null when
// there is none outside the streamed blocks.
export function firstHtmlArticle(
  html: string,
): { heading: string; text: string } | null {
  const shown = withoutStreamedBlocks(html).replace(
    /<(script|style|template)\b[\s\S]*?<\/\1>/gi,
    "",
  );
  const article = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(shown);
  if (!article) return null;
  const heading = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(article[1]);
  return { heading: textOf(heading?.[1] ?? ""), text: textOf(article[1]) };
}

// Why a page's text is not in its first HTML, or null when it is.
export function firstHtmlProblem(html: string): string | null {
  const article = firstHtmlArticle(html);
  if (!article) return "no <article> outside the streamed blocks";
  if (!article.heading)
    return "the <article> outside the streamed blocks has no <h1> text (only the loading skeleton?)";
  const rest = article.text.length - article.heading.length;
  if (rest < MIN_TEXT)
    return `the <article> outside the streamed blocks has ${rest} characters beside its heading`;
  return null;
}
