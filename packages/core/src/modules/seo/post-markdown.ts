import { compile, type DomNode, type FormatCallback } from "html-to-text";

/** The characters a post's text escapes so that it reads as written, not as Markdown. */
const ESCAPES: Record<string, string> = Object.fromEntries(
  ["\\", "*", "_", "[", "]", "<", ">", "`", "~", "#", "|"].map((char) => [char, `\\${char}`]),
);

const textOf = (node: DomNode): string =>
  node.type === "text" ? (node.data ?? "") : (node.children ?? []).map(textOf).join("");

/** An address as a Markdown link target: absolute, with nothing that would end it early. */
function target(href: string, origin: string): string | null {
  try {
    const url = new URL(href, origin);
    if (!/^(?:https?|mailto):$/.test(url.protocol)) return null;
    return url.href.replace(
      /[()\s<>]/g,
      (char) => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
    );
  } catch {
    return null;
  }
}

/** Backticks one more than the longest run in the text, at least `least`. */
function fence(text: string, least: number): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  return "`".repeat(Math.max(least, longest + 1));
}

const link =
  (origin: string): FormatCallback =>
  (elem, walk, builder) => {
    const url = target(String(elem.attribs?.href ?? ""), origin);
    if (!url) return walk(elem.children, builder);
    // A bare address is its own text.
    const text = textOf(elem).trim();
    if (!text || text === elem.attribs?.href) return builder.addLiteral(`<${url}>`);
    builder.addLiteral("[");
    walk(elem.children, builder);
    builder.addLiteral(`](${url})`);
  };

const image =
  (origin: string): FormatCallback =>
  (elem, _walk, builder) => {
    const url = target(String(elem.attribs?.src ?? ""), origin);
    if (!url) return;
    const alt = String(elem.attribs?.alt ?? "").replace(/[\\[\]]/g, "\\$&");
    builder.addLiteral(`![${alt}](${url})`);
  };

/** A player is a link to the page it plays. */
const player =
  (origin: string): FormatCallback =>
  (elem, _walk, builder) => {
    const url = target(String(elem.attribs?.["data-media-url"] ?? elem.attribs?.src ?? ""), origin);
    if (url) builder.addLiteral(`<${url}>`);
  };

/**
 * The document's own headings are the thread (`#`) and its posts (`##`): a post's headings start
 * at `####`, so nothing a member writes reads as a post of someone else.
 */
const heading: FormatCallback = (elem, walk, builder) => {
  const level = Math.min(6, (Number(elem.name?.slice(1)) || 1) + 3);
  builder.openBlock({ leadingLineBreaks: 2 });
  walk(elem.children, builder);
  builder.closeBlock({
    trailingLineBreaks: 2,
    blockTransform: (text) => `${"#".repeat(level)} ${text.replace(/\n+/g, " ")}`,
  });
};

/** Marks the lines of a code block until the whole post is written; never left in the output. */
const CODE_LINE = "\u0001";

/**
 * A line of only dashes or equals signs under a line of text turns that line into a heading
 * (setext): outside code, such a line gets its first sign escaped.
 */
function escapeUnderlines(markdown: string): string {
  const lines = markdown.split("\n");
  return lines
    .map((line, i) => {
      if (line.includes(CODE_LINE)) return line.replace(CODE_LINE, "");
      const previous = (lines[i - 1] ?? "").replace(CODE_LINE, "");
      if (!/[^>\s]/.test(previous)) return line;
      return line.replace(/^([>\s]*)(?=[-=][-=\s]*$)/, "$1\\");
    })
    .join("\n");
}

/**
 * A code block, fenced, named by its language when the post names one. Its lines are marked so
 * that `escapeUnderlines` leaves them as written.
 */
const codeBlock: FormatCallback = (elem, walk, builder) => {
  const named = /(?:^|\s)language-([\w+#.-]+)/.exec(String(elem.attribs?.class ?? ""))?.[1];
  const header = elem.parent?.children?.find((node) =>
    /\bbb-code-header\b/.test(String(node.attribs?.class ?? "")),
  );
  const language = (named ?? (header ? textOf(header).trim() : "")).replace(/[^\w+#.-]/g, "");
  builder.openBlock({ leadingLineBreaks: 2, isPre: true });
  walk(elem.children, builder);
  builder.closeBlock({
    trailingLineBreaks: 2,
    blockTransform: (text) => {
      const ticks = fence(text, 3);
      return `${ticks}${language}\n${text}\n${ticks}`.replace(/^/gm, CODE_LINE);
    },
  });
};

const inlineCode: FormatCallback = (elem, _walk, builder) => {
  const text = textOf(elem).replace(/\s*\n\s*/g, " ");
  if (!text) return;
  const ticks = fence(text, 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  builder.addLiteral(`${ticks}${pad}${text}${pad}${ticks}`);
};

/** The author line of a quote, on a line of its own. */
const quoteAuthor: FormatCallback = (elem, walk, builder) => {
  builder.openBlock({ leadingLineBreaks: 1 });
  builder.addLiteral("**");
  walk(elem.children, builder);
  builder.addLiteral("**");
  builder.closeBlock({ trailingLineBreaks: 1 });
};

/** A table as a pipe table; the first row heads it. A cell is one line. */
const table: FormatCallback = (elem, walk, builder) => {
  builder.openTable();
  const rows = (node: DomNode): DomNode[] =>
    (node.children ?? []).flatMap((child) =>
      child.name === "tr" ? [child] : child.type === "tag" ? rows(child) : [],
    );
  for (const row of rows(elem)) {
    builder.openTableRow();
    for (const cell of row.children ?? []) {
      if (cell.name !== "td" && cell.name !== "th") continue;
      builder.openTableCell();
      walk(cell.children, builder);
      builder.closeTableCell();
    }
    builder.closeTableRow();
  }
  builder.closeTable({
    leadingLineBreaks: 2,
    trailingLineBreaks: 2,
    tableToString: (cells) => {
      const width = Math.max(1, ...cells.map((row) => row.length));
      const line = (row: string[]) =>
        `| ${Array.from({ length: width }, (_, i) => row[i] ?? "").join(" | ")} |`;
      const lines = cells.map((row) =>
        line(row.map((cell) => cell.text.replace(/\s*\n\s*/g, " ").trim())),
      );
      if (!lines.length) return "";
      lines.splice(1, 0, line(Array.from({ length: width }, () => "---")));
      return lines.join("\n");
    },
  });
};

const converters = new Map<string, (html: string) => string>();

/**
 * A post's stored HTML (the renderer's output, already sanitized) as Markdown: the same text the
 * page shows, with relative addresses made absolute on `origin`. A spoiler's content is not in
 * the stored HTML and stays a `[spoiler]` mark; an attachment is an `[attachment]` mark (its file
 * has its own access check); a player is a link to its page.
 */
export function postMarkdown(html: string, origin: string): string {
  let convert = converters.get(origin);
  if (!convert) {
    convert = compile({
      wordwrap: false,
      encodeCharacters: ESCAPES,
      formatters: {
        link: link(origin),
        image: image(origin),
        player: player(origin),
        heading,
        codeBlock,
        inlineCode,
        quoteAuthor,
        table,
      },
      selectors: [
        { selector: "a", format: "link" },
        { selector: "img", format: "image" },
        { selector: "iframe", format: "player" },
        ...["h1", "h2", "h3", "h4", "h5", "h6"].map((selector) => ({
          selector,
          format: "heading",
        })),
        { selector: "pre", format: "codeBlock" },
        { selector: "code", format: "inlineCode" },
        { selector: "pre > code", format: "inline" },
        { selector: "div.bb-code-header", format: "skip" },
        { selector: "strong", format: "inlineSurround", options: { prefix: "**", suffix: "**" } },
        { selector: "em", format: "inlineSurround", options: { prefix: "*", suffix: "*" } },
        { selector: "del", format: "inlineSurround", options: { prefix: "~~", suffix: "~~" } },
        { selector: "cite", format: "quoteAuthor" },
        { selector: "ul", format: "unorderedList", options: { itemPrefix: "- " } },
        { selector: "table", format: "table" },
        { selector: "hr", format: "blockString", options: { string: "---" } },
        {
          selector: "div",
          format: "block",
          options: { leadingLineBreaks: 2, trailingLineBreaks: 2 },
        },
        { selector: "div.bb-spoiler", format: "blockString", options: { string: "[spoiler]" } },
        { selector: "details", format: "blockString", options: { string: "[spoiler]" } },
        { selector: "span.bb-spoiler", format: "inlineString", options: { string: "[spoiler]" } },
        { selector: "span.spoiler", format: "inlineString", options: { string: "[spoiler]" } },
        { selector: "span.bb-attach", format: "inlineString", options: { string: "[attachment]" } },
      ],
    });
    converters.set(origin, convert);
  }
  return escapeUnderlines(convert(html.replaceAll(CODE_LINE, ""))).trim();
}
