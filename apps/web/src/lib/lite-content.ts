import { parseEntities } from "parse-entities";
import {
  closerFinder,
  literalContentOk,
  readsLiterally,
  TAG_SOURCE,
  tagOf,
} from "@/components/forum/bb-scan";
import { blocksContentImage } from "./lite-images";
import { blocks, type LiteState } from "./lite-preferences";

const ALL: LiteState = { master: true, blocked: [] };
type Edit = { start: number; end: number; text: string };
// The English label, for a caller that does not know the visitor's language.
const LABEL = "DATA SAVER";

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
    // What stands in for it when blocked: the label, or a link for an embedded player.
    text: string;
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
        text: element.text,
      });
  }
  for (const node of nodes) {
    const offset = node.offset;
    // Tokenize the HTML tags of each chunk.
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
            edits.push({ start: element.start, end, text: element.text });
        }
        continue;
      }
      let blocked = MEDIA.has(tag) && blocks(state, "postImages");
      let text = label;
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
        } else if (tag === "iframe" && name === "data-media-url") {
          // An embedded player (BB code MEDIA) carries its page's address: LITE mode keeps a link.
          if (/^https?:\/\/[^\s"'<>&]+$/.test(value))
            text = `<a href="${value}" rel="nofollow ugc noopener">${value}</a>`;
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
      stack.push({
        tag,
        start,
        blocked,
        nodeEnd: offset + node.value.length,
        text,
      });
      if (VOID.has(tag) || /\/\s*>$/.test(match[0])) finish(end);
    }
  }
  while (stack.length) finish();
  return edits;
}

// Takes the pictures out of BB code as it is written: each [IMG] tag whose picture is blocked
// becomes `label` (an empty one drops it), and nothing else changes, so a link around a picture
// stays a link and the rest of the text is as it was typed. Code and PLAIN text show tags as text
// and are left as they are. For text that goes back into an editor, never for text a member
// could save: the backend's HTML has its own filter, `stripHtmlMedia`.
export function stripBbCodeImages(
  source: string,
  state: LiteState = ALL,
  origin?: string,
  label = LABEL,
): string {
  if (!state.master && state.blocked.length === 0) return source;
  const find = closerFinder(source);
  const tags = new RegExp(TAG_SOURCE, "g");
  const edits: Edit[] = [];
  for (let m = tags.exec(source); m; m = tags.exec(source)) {
    const tag = tagOf(m);
    if (!tag) {
      tags.lastIndex = m.index + 1;
      continue;
    }
    // Code, plain text and a picture read what is inside as it is (rich code reads the pictures
    // in it, so it is not one of them).
    if (tag.closing || !readsLiterally(tag.name, tag.option)) continue;
    const from = m.index + m[0].length;
    const closer = find(tag.name, from);
    if (closer < 0 || !literalContentOk(tag.name, source.slice(from, closer))) {
      continue;
    }
    const end = closer + tag.name.length + 3;
    tags.lastIndex = end;
    if (
      tag.name === "IMG" &&
      blocksContentImage(state, source.slice(from, closer).trim(), origin)
    ) {
      edits.push({ start: m.index, end, text: label });
    }
  }
  return applyEdits(source, edits);
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

// For HTML the backend rendered and sanitised, taken as a whole. A blocked picture is replaced by the label; nothing else is added or changed.
export function stripHtmlMedia(
  html: string,
  state: LiteState,
  origin?: string,
  label = LABEL,
): string {
  if (!state.master && state.blocked.length === 0) return html;
  return applyEdits(
    html,
    htmlEdits([{ value: html, offset: 0 }], state, label, origin),
  );
}
