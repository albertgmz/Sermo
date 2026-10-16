import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { withIntl } from "@/lib/test-intl";
import { Editor } from "./editor";
import {
  type CommandId,
  layoutAt,
  SHOWN,
  type Shown,
  SIZE_FROM,
  sizesOf,
  TOOLBAR_SIZES,
  type ToolbarSize,
} from "./editor-toolbar-layout";

const text = messages.editor.editor;

const LABELS: Record<CommandId, string> = {
  bold: text.boldLabel,
  italic: text.italicLabel,
  underline: text.underlineLabel,
  strikethrough: text.strikethroughLabel,
  code: text.inlineCodeLabel,
  removeFormatting: text.removeFormattingLabel,
  heading: text.headingLabel,
  bullet: text.bulletListLabel,
  number: text.numberedListLabel,
  quote: text.quoteLabel,
  link: text.linkLabel,
  spoiler: text.spoilerLabel,
  codeBlock: text.codeBlockLabel,
  media: text.mediaLabel,
  source: text.sourceLabel,
  undo: text.undoLabel,
  redo: text.redoLabel,
};

const EVERY_COMMAND = Object.keys(LABELS).sort();

// The narrowest bar the toolbar is drawn in without wrapping: a 280 px screen's editor alone.
const NARROWEST = 280;

// A bar of each size, at its narrowest and at its widest.
const WIDTHS: [ToolbarSize, number][] = TOOLBAR_SIZES.flatMap(
  (size, index): [ToolbarSize, number][] => {
    const next = TOOLBAR_SIZES[index + 1];
    return [
      [size, Math.max(SIZE_FROM[size], NARROWEST)],
      [size, next ? SIZE_FROM[next] - 1 : 1400],
    ];
  },
);

// Whether an element with these classes is drawn in a bar this wide, read the way the container
// queries apply: the base class, then each `@min-[Npx]:` class the width reaches, narrowest first.
function shownAt(classes: string[], width: number) {
  let shown = !classes.includes("hidden");
  const queries = classes
    .map((name) => name.match(/^@min-\[(\d+)px\]:(hidden|flex)$/))
    .filter((match) => match !== null)
    .map((match) => ({ from: Number(match[1]), display: match[2] }))
    .sort((a, b) => a.from - b.from);
  for (const query of queries) {
    if (width >= query.from) shown = query.display === "flex";
  }
  return shown;
}

// The labels of the bar's buttons and menu buttons a bar this wide shows, in order.
function visibleControls(html: string, width: number) {
  const bar = html.match(/role="toolbar"[\s\S]*?<\/div>/)?.[0] ?? "";
  const labels: string[] = [];
  for (const [tag] of bar.matchAll(/<button[^>]*>/g)) {
    const label = tag.match(/aria-label="([^"]*)"/)?.[1];
    const classes = tag.match(/class="([^"]*)"/)?.[1].split(" ") ?? [];
    if (label && shownAt(classes, width)) labels.push(label);
  }
  return labels;
}

const menuLabel = (id: keyof typeof text.menus) => text.menus[id];

test("each size has its agreed buttons and menus", () => {
  expect(layoutAt("lg")).toEqual({
    direct: [
      "bold",
      "italic",
      "underline",
      "strikethrough",
      "code",
      "removeFormatting",
      "heading",
      "bullet",
      "number",
      "quote",
      "link",
      "spoiler",
      "codeBlock",
      "media",
      "source",
      "undo",
      "redo",
    ],
    menus: [],
  });
  expect(layoutAt("md")).toEqual({
    direct: ["bold", "italic", "link", "media", "source", "undo", "redo"],
    menus: [
      {
        id: "text",
        items: ["underline", "strikethrough", "code", "removeFormatting"],
      },
      { id: "paragraph", items: ["heading", "bullet", "number", "quote"] },
      { id: "insert", items: ["spoiler", "codeBlock"] },
    ],
  });
  expect(layoutAt("sm")).toEqual({
    direct: ["bold", "italic", "link", "source", "undo", "redo"],
    menus: [
      {
        id: "text",
        items: ["underline", "strikethrough", "code", "removeFormatting"],
      },
      { id: "paragraph", items: ["heading", "bullet", "number", "quote"] },
      { id: "insert", items: ["spoiler", "codeBlock", "media"] },
    ],
  });
  expect(layoutAt("xsWide")).toEqual({
    direct: ["bold", "italic", "undo", "redo"],
    menus: [
      {
        id: "text",
        items: ["underline", "strikethrough", "code", "removeFormatting"],
      },
      { id: "paragraph", items: ["heading", "bullet", "number", "quote"] },
      { id: "insert", items: ["link", "spoiler", "codeBlock", "media"] },
      { id: "more", items: ["source"] },
    ],
  });
  expect(layoutAt("xs")).toEqual({
    direct: ["undo", "redo"],
    menus: [
      {
        id: "text",
        items: [
          "bold",
          "italic",
          "underline",
          "strikethrough",
          "code",
          "removeFormatting",
        ],
      },
      { id: "paragraph", items: ["heading", "bullet", "number", "quote"] },
      { id: "insert", items: ["link", "spoiler", "codeBlock", "media"] },
      { id: "more", items: ["source"] },
    ],
  });
});

test("every command is in the bar exactly once at every size", () => {
  for (const size of TOOLBAR_SIZES) {
    const { direct, menus } = layoutAt(size);
    const reachable = [...direct, ...menus.flatMap((menu) => menu.items)];
    expect([...reachable].sort()).toEqual(EVERY_COMMAND);
  }
});

test("a smaller bar never shows a button a larger one keeps in a menu", () => {
  for (let index = 1; index < TOOLBAR_SIZES.length; index += 1) {
    const smaller = layoutAt(TOOLBAR_SIZES[index - 1]).direct;
    const larger = layoutAt(TOOLBAR_SIZES[index]).direct;
    for (const id of smaller) expect(larger).toContain(id);
  }
});

test("the bar draws, at each width, the buttons and menu buttons of its size", () => {
  const html = renderToStaticMarkup(withIntl(<Editor name="body" />));
  for (const [size, width] of WIDTHS) {
    const { direct, menus } = layoutAt(size);
    const expected = [
      ...direct.map((id) => LABELS[id]),
      ...menus.map((menu) => menuLabel(menu.id)),
    ].sort();
    expect({ width, controls: visibleControls(html, width).sort() }).toEqual({
      width,
      controls: expected,
    });
  }
});

test("the classes switch each part of the bar at the widths the sizes start from", () => {
  const breakpoints = new Set(
    Object.values(SHOWN).flatMap((classes) =>
      [...classes.matchAll(/@min-\[(\d+)px\]/g)].map((match) =>
        Number(match[1]),
      ),
    ),
  );
  expect([...breakpoints].sort((a, b) => a - b)).toEqual(
    TOOLBAR_SIZES.map((size) => SIZE_FROM[size]).filter((from) => from > 0),
  );
  for (const shown of Object.keys(SHOWN) as Shown[]) {
    for (const [size, width] of WIDTHS) {
      expect({
        shown,
        width,
        on: shownAt(SHOWN[shown].split(" "), width),
      }).toEqual({ shown, width, on: sizesOf(shown).includes(size) });
    }
  }
});

test("the bar fits its narrowest width with phone-sized buttons, and wraps rather than scrolls", () => {
  // Every control is 40 px wide on a phone (a menu button too), 2 px apart (the gap between the
  // start and the end of the bar included); a divider takes 11 px; the bar's padding 12 px.
  for (const size of TOOLBAR_SIZES) {
    const { direct, menus } = layoutAt(size);
    const controls = direct.length + menus.length;
    const dividers = size === "md" || size === "lg" ? 2 : 0;
    const width = controls * 42 - 2 + dividers * 11 + 12;
    const narrowest = Math.max(SIZE_FROM[size], NARROWEST);
    expect({ size, fits: width <= narrowest }).toEqual({
      size,
      fits: true,
    });
  }
  const html = renderToStaticMarkup(withIntl(<Editor name="body" />));
  // The width the size is chosen from is the bar's own.
  expect(html).toMatch(/<div class="@container"><div role="toolbar"/);
  const bar = html.match(/role="toolbar"[^>]*class="([^"]*)"/)?.[1] ?? "";
  expect(bar.split(" ")).toContain("flex-wrap");
  expect(bar).not.toContain("overflow-x");
});

test("the bar has an underline button and the button that shows the BB code source", () => {
  const html = renderToStaticMarkup(withIntl(<Editor name="body" />));
  expect(html).toContain(`aria-label="${text.underlineLabel}"`);
  expect(html).toContain(`aria-label="${text.sourceLabel}"`);
  // The source is not shown until it is asked for, and the rich text is.
  expect(html).not.toContain("<textarea");
  expect(html).toContain('role="textbox"');
});

test("an editor with no bar has no way to the source, and still sends BB code", () => {
  const html = renderToStaticMarkup(
    withIntl(<Editor compact name="body" defaultValue="[B]x[/B]" />),
  );
  expect(html).not.toContain(`aria-label="${text.sourceLabel}"`);
  expect(html).not.toContain('role="toolbar"');
  expect(html).toContain('name="body"');
  expect(html).toContain('value="[B]x[/B]"');
});

test("the text an editor opens with is what its field holds until the member changes it", () => {
  const source = "[b]loose[/b]\r\n\r\n\r\n\r\ntext";
  const html = renderToStaticMarkup(
    withIntl(<Editor name="body" defaultValue={source} />),
  );
  expect(html).toContain(`value="${source}"`);
});
