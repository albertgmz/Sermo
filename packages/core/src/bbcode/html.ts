import type { Deadline } from "./deadline";
import { escapeHtml } from "./escape";
import { highlightCode } from "./highlight";
import { colorValue, FONT_CLASS, type Tok } from "./scan";
import { type El, isBlock, type MentionNode, type Node } from "./tree";

/** Longer code is shown as a plain block: highlighting cost grows with its length. */
const HIGHLIGHT_LIMIT = 2_000;
/** Characters one message may have highlighted in all; later code blocks are plain. */
const HIGHLIGHT_TOTAL = 6_000;

/**
 * Where the spoilers of content with an actor go. Their HTML leaves the body: each spoiler becomes a
 * placeholder carrying its position, and `html[position]` keeps its sanitized inner HTML. Without a
 * sink (texts with no per-reader visibility) spoilers stay inline in a closed block.
 */
export interface SpoilerSink {
  html: string[];
  sanitize(html: string): string;
}

interface Env {
  sink?: SpoilerSink;
  deadline: Deadline;
  highlighted: number;
}

function trimNewlines(text: string, leading = true, trailing = true): string {
  let start = 0;
  let end = text.length;
  while (leading && start < end && text.charCodeAt(start) === 10) start++;
  while (trailing && end > start && text.charCodeAt(end - 1) === 10) end--;
  return text.slice(start, end);
}

/** Splits at blank lines (a newline, optional spaces, a newline); the blank run is dropped. */
function splitBlank(text: string): string[] {
  const parts: string[] = [];
  let last = 0;
  let at = text.indexOf("\n");
  while (at >= 0) {
    let next = at + 1;
    while (text.charCodeAt(next) === 32 || text.charCodeAt(next) === 9) next++;
    if (text.charCodeAt(next) === 10) {
      let end = next + 1;
      while (end < text.length && /\s/.test(text[end]!)) end++;
      parts.push(text.slice(last, at));
      last = end;
      at = text.indexOf("\n", end);
    } else {
      at = text.indexOf("\n", at + 1);
    }
  }
  parts.push(text.slice(last));
  return parts;
}

/** The nodes without the white space at either end (text nodes that empty out are dropped). */
function trimEdges(nodes: Node[]): Node[] {
  const result = nodes.slice();
  while (result.length) {
    const first = result[0]!;
    if (first.t !== "text") break;
    const text = first.text.trimStart();
    if (text) {
      result[0] = { t: "text", text };
      break;
    }
    result.shift();
  }
  while (result.length) {
    const last = result[result.length - 1]!;
    if (last.t !== "text") break;
    const text = last.text.trimEnd();
    if (text) {
      result[result.length - 1] = { t: "text", text };
      break;
    }
    result.pop();
  }
  return result;
}

type Item = { paragraph: Node[] } | { block: Node };

/** Runs of inline nodes between blocks, cut into paragraphs at blank lines. */
function items(kids: Node[]): Item[] {
  const out: Item[] = [];
  let paragraph: Node[] = [];
  const end = () => {
    const nodes = trimEdges(paragraph);
    if (nodes.length) out.push({ paragraph: nodes });
    paragraph = [];
  };
  for (const kid of kids) {
    if (isBlock(kid)) {
      end();
      out.push({ block: kid });
    } else if (kid.t === "text") {
      splitBlank(kid.text).forEach((part, index) => {
        if (index > 0) end();
        if (part) paragraph.push({ t: "text", text: part });
      });
    } else {
      paragraph.push(kid);
    }
  }
  end();
  return out;
}

/**
 * The blocks of a tag's content. A single paragraph is returned bare (`tight`); in a list item
 * (`item`) the text before a nested block also stays bare. Otherwise every paragraph is a `<p>`.
 */
function blocks(kids: Node[], env: Env, inLink: boolean, mode: "root" | "tight" | "item"): string {
  const parts = items(kids);
  const first = parts[0];
  if (mode !== "root" && first && "paragraph" in first) {
    const rest = parts.slice(1);
    if (rest.length === 0 || (mode === "item" && rest.every((part) => "block" in part)))
      return (
        inline(first.paragraph, env, inLink, false) +
        rest.map((part) => node((part as { block: Node }).block, env, inLink, false)).join("")
      );
  }
  return parts
    .map((part) =>
      "paragraph" in part
        ? `<p>${inline(part.paragraph, env, inLink, false)}</p>`
        : node(part.block, env, inLink, false),
    )
    .join("");
}

function inline(kids: Node[], env: Env, inLink: boolean, pre: boolean): string {
  let html = "";
  for (const kid of kids) html += node(kid, env, inLink, pre);
  return html;
}

function text(value: string, pre: boolean): string {
  const escaped = escapeHtml(value);
  return pre ? escaped : escaped.replace(/\n/g, "<br>");
}

function spoiler(
  env: Env,
  inlineSpoiler: boolean,
  title: string | null,
  body: () => string,
): string | null {
  const sink = env.sink;
  if (!sink) return null;
  const position = sink.html.length;
  sink.html.push("");
  sink.html[position] = sink.sanitize(body());
  if (inlineSpoiler)
    return `<span class="bb-spoiler bb-spoiler-inline" data-spoiler="${position}"></span>`;
  const label = title ? ` data-spoiler-title="${escapeHtml(title)}"` : "";
  return `<div class="bb-spoiler" data-spoiler="${position}"${label}></div>`;
}

function codeBlock(tok: Tok, env: Env): string {
  const content = trimNewlines(tok.text!);
  const language = tok.language;
  let header = `<div class="bb-code-header"></div>`;
  let pre = `<pre><code>${escapeHtml(content)}</code></pre>`;
  if (language !== undefined) {
    const highlighted =
      content.length <= HIGHLIGHT_LIMIT && env.highlighted + content.length <= HIGHLIGHT_TOTAL
        ? highlightCode(content, language)
        : null;
    if (highlighted) env.highlighted += content.length;
    header = `<div class="bb-code-header bb-code-named"><span class="bb-code-lang">${escapeHtml(highlighted ? highlighted.name : language)}</span></div>`;
    if (highlighted)
      pre = `<pre class="hljs language-${highlighted.id}"><code>${highlighted.html}</code></pre>`;
  }
  return `<div class="bb-code">${header}${pre}</div>`;
}

function atom(tok: Tok, plainInline: boolean, env: Env, inLink: boolean): string {
  switch (tok.name) {
    case "CODE":
      return codeBlock(tok, env);
    case "ICODE":
      return `<code>${escapeHtml(tok.text!)}</code>`;
    case "PLAIN":
      return plainInline || !tok.text!.includes("\n\n")
        ? text(tok.text!, false)
        : `<div class="bb-plain">${text(trimNewlines(tok.text!), false)}</div>`;
    case "IMG":
      return `<img src="${escapeHtml(tok.href!)}" alt="">`;
    case "MEDIA":
      return tok.html!;
    case "ATTACH":
      return `<span class="bb-attach" data-attach-id="${tok.id}" data-attach-size="${tok.size}">${tok.id}</span>`;
    case "URL":
    case "EMAIL":
      return inLink
        ? escapeHtml(tok.text ?? tok.href!)
        : `<a href="${escapeHtml(tok.href!)}">${escapeHtml(tok.text ?? tok.href!)}</a>`;
    case "HR":
      return "<hr>";
  }
  return "";
}

function mention(mentionNode: MentionNode): string {
  if (mentionNode.userId)
    return `<a href="/members/${mentionNode.userId}" class="mention" data-user-id="${mentionNode.userId}">@${escapeHtml(mentionNode.displayName!)}</a>`;
  return escapeHtml(mentionNode.fallback);
}

const WRAP: Record<string, string> = { B: "strong", I: "em", U: "u", S: "del" };

function quote(el: El, env: Env, inLink: boolean): string {
  const body = blocks(el.kids, env, inLink, "tight");
  const data = el.quote!;
  if (data.resolvedAuthor && data.postId)
    return `<blockquote class="quote" data-post-id="${data.postId}"><cite><a href="/posts/${data.postId}">${escapeHtml(data.resolvedAuthor)}</a> wrote:</cite>${body}</blockquote>`;
  const author = data.author
    ? `<cite class="bb-quote-author">${escapeHtml(data.author)}</cite>`
    : "";
  return `<blockquote class="bb-quote">${author}${body}</blockquote>`;
}

function list(el: El, env: Env, inLink: boolean): string {
  const entries: Node[][] = [];
  const lead: Node[] = [];
  for (const kid of el.kids) {
    if (kid.t === "el" && kid.name === "*") entries.push(kid.kids);
    else lead.push(kid);
  }
  // Text before the first [*] is dropped when blank and is an item of its own otherwise.
  if (trimEdges(lead).length) entries.unshift(lead);
  const tag = el.option === "1" ? "ol" : "ul";
  const content = entries.map((kids) => `<li>${blocks(kids, env, inLink, "item")}</li>`).join("");
  return `<${tag}>${content}</${tag}>`;
}

function table(el: El, env: Env, inLink: boolean): string {
  const rows = el.kids
    .filter((row): row is El => row.t === "el" && row.name === "TR")
    .map((row) => {
      const cells = row.kids
        .filter((cell): cell is El => cell.t === "el" && (cell.name === "TH" || cell.name === "TD"))
        .map((cell) => {
          const tag = cell.name === "TH" ? "th" : "td";
          return `<${tag}>${blocks(cell.kids, env, inLink, "tight")}</${tag}>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  return `<table class="bb-table"><tbody>${rows}</tbody></table>`;
}

/** Rich code shows its text as typed, with the tags drawn. */
function richCode(el: El, env: Env, inLink: boolean): string {
  const kids = el.kids.slice();
  const first = kids[0];
  if (first?.t === "text") kids[0] = { t: "text", text: trimNewlines(first.text, true, false) };
  const last = kids[kids.length - 1];
  if (last?.t === "text")
    kids[kids.length - 1] = { t: "text", text: trimNewlines(last.text, false, true) };
  return `<div class="bb-code"><div class="bb-code-header bb-code-rich"></div><pre><code>${inline(kids, env, inLink, true)}</code></pre></div>`;
}

function element(el: El, env: Env, inLink: boolean, pre: boolean): string {
  const children = () => inline(el.kids, env, inLink, pre);
  switch (el.name) {
    case "B":
    case "I":
    case "U":
    case "S":
      return `<${WRAP[el.name]}>${children()}</${WRAP[el.name]}>`;
    case "COLOR":
      return `<span style="color:${colorValue(el.option)}">${children()}</span>`;
    case "FONT":
      return `<span class="bb-font-${FONT_CLASS.get(el.option!.toLowerCase())}">${children()}</span>`;
    case "SIZE":
      return `<span class="bb-size-${el.option}">${children()}</span>`;
    case "URL":
    case "EMAIL": {
      if (inLink) return inline(el.kids, env, true, pre);
      const href = el.name === "EMAIL" ? `mailto:${el.option}` : el.option;
      return `<a href="${escapeHtml(href!)}">${inline(el.kids, env, true, pre)}</a>`;
    }
    case "ISPOILER":
      return spoiler(env, true, null, children) ?? `<span class="spoiler">${children()}</span>`;
    case "ICODE":
      return `<code>${inline(el.kids, env, inLink, true)}</code>`;
    case "CODE":
      return richCode(el, env, inLink);
    case "LEFT":
    case "CENTER":
    case "RIGHT":
      return `<div class="bb-${el.name.toLowerCase()}">${blocks(el.kids, env, inLink, "tight")}</div>`;
    case "INDENT": {
      const level = Number(el.option ?? 1);
      return `<div class="bb-indent bb-indent-${level}">${blocks(el.kids, env, inLink, "tight")}</div>`;
    }
    case "QUOTE":
      return quote(el, env, inLink);
    case "SPOILER": {
      const title = el.option || null;
      const content = () => blocks(el.kids, env, inLink, "tight");
      const placeholder = spoiler(env, false, title, content);
      if (placeholder) return placeholder;
      const summary = title
        ? `<summary class="bb-spoiler-summary bb-has-title">${escapeHtml(title)}</summary>`
        : `<summary class="bb-spoiler-summary"></summary>`;
      return `<details class="spoiler">${summary}${content()}</details>`;
    }
    case "HEADING":
      return `<h${el.option}>${inline(trimEdges(el.kids), env, inLink, pre)}</h${el.option}>`;
    case "LIST":
      return list(el, env, inLink);
    case "TABLE":
      return table(el, env, inLink);
  }
  return "";
}

function node(kid: Node, env: Env, inLink: boolean, pre: boolean): string {
  env.deadline.tick();
  switch (kid.t) {
    case "text":
      return text(kid.text, pre);
    case "link":
      return `<a href="${escapeHtml(kid.href)}">${escapeHtml(kid.text)}</a>`;
    case "mention":
      return mention(kid);
    case "atom":
      return atom(kid.tok, kid.inline, env, inLink);
    case "el":
      return element(kid, env, inLink, pre);
  }
}

/** The HTML of a tree (unsanitized: the caller passes it through the sanitizer). */
export function renderTree(kids: Node[], deadline: Deadline, sink?: SpoilerSink): string {
  return blocks(kids, { sink, deadline, highlighted: 0 }, false, "root");
}

/** How many paragraphs and blocks the top level of a tree holds. */
export function blockCount(kids: Node[]): number {
  return items(kids).length;
}
