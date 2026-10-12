import type { Root, RootContent } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

const parser = unified().use(remarkParse).use(remarkGfm);

// Edit source ranges so links and the rest of the member's formatting survive.
export function stripMarkdownImages(markdown: string): string {
  const tree = parser.parse(markdown);
  const links = new Set<string>();
  const definitions: RootContent[] = [];
  const edits: { start: number; end: number; text: string }[] = [];

  function replace(node: RootContent, text: string) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start !== undefined && end !== undefined)
      edits.push({ start, end, text });
  }

  function visit(node: Root | RootContent) {
    if (node.type === "image" || node.type === "imageReference") {
      replace(node, "LITE MODE");
    } else if (node.type === "definition") {
      definitions.push(node);
    } else if (node.type === "linkReference") {
      links.add(node.identifier);
    }
    if ("children" in node) node.children.forEach(visit);
  }

  visit(tree);
  for (const node of definitions) {
    if (node.type === "definition" && !links.has(node.identifier))
      replace(node, "");
  }
  for (const { start, end, text } of edits.sort((a, b) => b.start - a.start)) {
    markdown = markdown.slice(0, start) + text + markdown.slice(end);
  }
  return markdown;
}
