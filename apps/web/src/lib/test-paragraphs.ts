// The block elements the browser's parser would split a paragraph at: any of them inside a `<p>`
// closes it, and its end tag leaves an empty paragraph behind. Returns what is found, per
// paragraph of `html`.
const BLOCKS =
  /<(?:div|p|ul|ol|li|h[1-6]|table|pre|blockquote|hr|section|article)\b/i;

export function blocksInParagraphs(html: string): string[] {
  return [...html.matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/gi)].flatMap(
    ([, inner]) => (inner && BLOCKS.test(inner) ? [inner] : []),
  );
}
