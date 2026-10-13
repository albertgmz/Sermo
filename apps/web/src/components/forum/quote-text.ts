// The renderer ends a container at the first `:::` line that is not inside a code fence, and
// counts every `:::quote` or `:::spoiler` line it meets as one that must be closed in turn
// (packages/core/src/markdown/extensions.ts). A quoted body can therefore end its own quote, or
// swallow the closing line, unless those lines are made plain text. A line indented by one space
// is no container line and still reads as the same text, and balanced containers are kept as
// they are, so a quote inside a quote stays one. Fences follow the renderer's reading.
const OPENING = /^:::(?:quote|spoiler)(?:\{[^\n}]*\})?[ \t]*$/;
const CLOSING = /^:::[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

function contained(source: string) {
  const lines = source.split("\n");
  const open: number[] = [];
  let fence: { marker: string; length: number } | null = null;
  for (const [index, line] of lines.entries()) {
    const found = FENCE.exec(line);
    if (fence) {
      if (
        found &&
        found[1][0] === fence.marker &&
        found[1].length >= fence.length &&
        /^\s*$/.test(line.slice(found[0].length))
      ) {
        fence = null;
      }
    } else if (found) {
      fence = { marker: found[1][0], length: found[1].length };
    } else if (OPENING.test(line)) {
      open.push(index);
    } else if (CLOSING.test(line)) {
      const matched = open.pop();
      if (matched === undefined) lines[index] = ` ${line}`;
    }
  }
  for (const index of open) lines[index] = ` ${lines[index]}`;
  // A code fence left open would swallow the closing line of the quote.
  if (fence) lines.push(fence.marker.repeat(fence.length));
  return lines.join("\n");
}

// A post quoted the way the Markdown renderer reads it: a quote container that names the post and,
// when the name can sit between quotation marks, its author. The renderer fills in the author
// itself from the post, so a name left out here costs nothing.
export function quoteOf(postId: number, author: string, source: string) {
  const name = /["}\n]/.test(author) ? "" : ` author="${author}"`;
  return `:::quote{post=${postId}${name}}\n${contained(source.trim())}\n:::`;
}
