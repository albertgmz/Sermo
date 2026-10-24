// A quote inside a quote grows a post fast, so from the second level a quote is folded: a
// `<details>` whose summary holds the quote's header (author and link to the quoted post) and a
// hint whose words come from CSS, in the visitor's language. A quote directly in the post stays
// open. The HTML is the backend's, already sanitised, so its quotes are balanced and the tags are
// found by shape.
const TAGS = /<blockquote\b[^>]*>|<\/blockquote>/g;
const HEADER = /\s*<cite\b[^>]*>[\s\S]*?<\/cite>/y;

export function foldNestedQuotes(html: string): string {
  if (!html.includes("<blockquote")) return html;
  // One entry per open quote: whether it was folded, and so needs its `</details>`.
  const open: boolean[] = [];
  let out = "";
  let from = 0;
  for (const match of html.matchAll(TAGS)) {
    const end = match.index + match[0].length;
    out += html.slice(from, match.index);
    from = end;
    if (match[0] === "</blockquote>") {
      out += open.pop() ? "</details></blockquote>" : match[0];
      continue;
    }
    const folded = open.length > 0;
    open.push(folded);
    out += match[0];
    if (!folded) continue;
    HEADER.lastIndex = end;
    const cite = HEADER.exec(html)?.[0] ?? "";
    from = end + cite.length;
    out +=
      '<details class="bb-quote-fold"><summary class="bb-quote-fold-summary">' +
      `${cite.trim()}<span class="bb-quote-fold-hint"></span></summary>`;
  }
  return out + html.slice(from);
}
