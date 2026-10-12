import type { Root, RootContent } from "mdast";
import { parseEntities } from "parse-entities";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { blocksContentImage } from "./lite-images";
import { blocks, type LiteState } from "./lite-preferences";

const parser = unified().use(remarkParse).use(remarkGfm);
const ALL: LiteState = { master: true, blocked: [] };
type Edit = { start: number; end: number; text: string };
const LABEL = "LITE MODE";

const MEDIA = new Set([
  "img",
  "picture",
  "source",
  "video",
  "audio",
  "svg",
  "object",
  "embed",
  "iframe",
]);
const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

type HtmlChunk = { value: string; offset: number };

function htmlEdits(
  nodes: HtmlChunk[],
  state: LiteState,
  label: string,
  origin?: string,
): Edit[] {
  const edits: Edit[] = [];
  const stack: {
    tag: string;
    start: number;
    blocked: boolean;
    nodeEnd: number;
  }[] = [];
  // An element closed by its end tag is replaced whole, even across blocks.
  // One that is never closed, or that an end tag of an outer element abandons,
  // loses its content only up to the end of the HTML node holding its opening
  // tag (a lone inline tag, or the rest of that HTML block), or up to the
  // abandoning end tag when that sits in the same node. Text after it is never
  // touched.
  function finish(end?: number) {
    const element = stack.pop();
    if (element?.blocked)
      edits.push({
        start: element.start,
        end: Math.min(end ?? Infinity, element.nodeEnd),
        text: label,
      });
  }
  for (const node of nodes) {
    const offset = node.offset;
    // Tokenize only Markdown HTML nodes. Inline, fenced and indented code are exempt.
    const tags = /<\/?([a-z][\w:-]*)(?=\s|\/?>)(?:"[^"]*"|'[^']*'|[^'">])*>/gi;
    for (const match of node.value.matchAll(tags)) {
      const tag = match[1].toLowerCase();
      const start = offset + match.index;
      const end = start + match[0].length;
      if (match[0].startsWith("</")) {
        const index = stack.findLastIndex((element) => element.tag === tag);
        if (index !== -1) {
          while (stack.length > index + 1) finish(start);
          const element = stack.pop();
          if (element?.blocked)
            edits.push({ start: element.start, end, text: label });
        }
        continue;
      }
      let blocked = MEDIA.has(tag) && blocks(state, "postImages");
      const attributes =
        /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
      for (const attribute of match[0].matchAll(attributes)) {
        const name = attribute[1].toLowerCase();
        const value = parseEntities(
          attribute[2] ?? attribute[3] ?? attribute[4],
        );
        if (name === "style" || name === "background") {
          for (const url of value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
            if (blocksContentImage(state, url[2], origin)) blocked = true;
          }
        } else if (
          MEDIA.has(tag) &&
          ["src", "href", "xlink:href", "poster", "data", "srcset"].includes(
            name,
          )
        ) {
          const sources =
            name === "srcset"
              ? value.split(",").map((part) => part.trim().split(/\s+/)[0])
              : [value];
          if (
            sources.some((source) => blocksContentImage(state, source, origin))
          )
            blocked = true;
        }
      }
      if (blocked) {
        for (const parent of stack)
          if (MEDIA.has(parent.tag)) parent.blocked = true;
      }
      stack.push({ tag, start, blocked, nodeEnd: offset + node.value.length });
      if (VOID.has(tag) || /\/\s*>$/.test(match[0])) finish(end);
    }
  }
  while (stack.length) finish();
  return edits;
}

export function stripMarkdownHtml(
  markdown: string,
  state: LiteState,
  origin?: string,
): string {
  return filterMarkdown(markdown, state, origin, false, LABEL);
}

// Edit source ranges so links and the rest of the member's formatting survive.
// `label` is what stands in for a removed picture; an empty one drops it.
export function stripMarkdownImages(
  markdown: string,
  state: LiteState = ALL,
  origin?: string,
  label = LABEL,
): string {
  return filterMarkdown(markdown, state, origin, true, label);
}

function filterMarkdown(
  markdown: string,
  state: LiteState,
  origin: string | undefined,
  images: boolean,
  label: string,
): string {
  if (!state.master && state.blocked.length === 0) return markdown;
  const tree = parser.parse(markdown);
  const links = new Set<string>();
  const removedReferences = new Set<string>();
  const definitions = new Map<
    string,
    Extract<RootContent, { type: "definition" }>
  >();
  const html: RootContent[] = [];
  const edits: Edit[] = [];

  function collect(node: Root | RootContent) {
    if (node.type === "definition" && !definitions.has(node.identifier))
      definitions.set(node.identifier, node);
    if (node.type === "html") html.push(node);
    if ("children" in node) node.children.forEach(collect);
  }
  collect(tree);

  function replace(node: RootContent, text: string) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start !== undefined && end !== undefined)
      edits.push({ start, end, text });
  }

  function visit(node: Root | RootContent) {
    if (
      images &&
      node.type === "image" &&
      blocksContentImage(state, node.url, origin)
    ) {
      replace(node, label);
    } else if (images && node.type === "imageReference") {
      const definition = definitions.get(node.identifier);
      if (definition && blocksContentImage(state, definition.url, origin)) {
        replace(node, label);
        removedReferences.add(node.identifier);
      }
    } else if (node.type === "linkReference") {
      links.add(node.identifier);
    }
    if ("children" in node) node.children.forEach(visit);
  }

  visit(tree);
  for (const node of definitions.values()) {
    if (removedReferences.has(node.identifier) && !links.has(node.identifier))
      replace(node, "");
  }
  const chunks = html.flatMap((node) =>
    node.type === "html" && node.position?.start.offset !== undefined
      ? [{ value: node.value, offset: node.position.start.offset }]
      : [],
  );
  edits.push(...htmlEdits(chunks, state, label, origin));
  return applyEdits(markdown, edits);
}

function applyEdits(text: string, edits: Edit[]): string {
  // A removed HTML container can enclose other edits; apply its range once.
  const ranges: Edit[] = [];
  for (const edit of edits.sort((a, b) => a.start - b.start || b.end - a.end)) {
    const previous = ranges.at(-1);
    if (previous && edit.start < previous.end)
      previous.end = Math.max(previous.end, edit.end);
    else ranges.push(edit);
  }
  for (const { start, end, text: replacement } of ranges.reverse()) {
    text = text.slice(0, start) + replacement + text.slice(end);
  }
  return text;
}

// For HTML the backend rendered and sanitised: the same rules as for HTML inside Markdown, applied
// to the whole text. A blocked picture is replaced by the label; nothing else is added or changed.
export function stripHtmlMedia(
  html: string,
  state: LiteState,
  origin?: string,
): string {
  if (!state.master && state.blocked.length === 0) return html;
  return applyEdits(
    html,
    htmlEdits([{ value: html, offset: 0 }], state, LABEL, origin),
  );
}
