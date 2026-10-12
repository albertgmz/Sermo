// A post quoted the way the Markdown renderer reads it: a quote container that names the post and,
// when the name can sit between quotation marks, its author. The renderer fills in the author
// itself from the post, so a name left out here costs nothing.
export function quoteOf(postId: number, author: string, source: string) {
  const name = /["}\n]/.test(author) ? "" : ` author="${author}"`;
  return `:::quote{post=${postId}${name}}\n${source.trim()}\n:::`;
}
