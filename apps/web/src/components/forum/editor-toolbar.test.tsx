import { expect, test } from "bun:test";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { renderToStaticMarkup } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { withIntl } from "@/lib/test-intl";
import { Editor } from "./editor";
import { SourceContext } from "./editor-extras";
import { Toolbar } from "./editor-toolbar";
import {
  type CommandId,
  GROUPS,
  type GroupId,
  layoutAt,
  SHOWN,
  type Shown,
  SIZE_FROM,
  sizesOf,
  TOOLBAR_SIZES,
  type ToolbarSize,
  toggleStrip,
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
  image: text.imageLabel,
  spoiler: text.spoilerLabel,
  codeBlock: text.codeBlockLabel,
  media: text.mediaLabel,
  source: text.sourceLabel,
  undo: text.undoLabel,
  redo: text.redoLabel,
};

const EVERY_COMMAND = Object.keys(LABELS).sort();

// The narrowest bar the toolbar is drawn in: the editor of a 320 px phone (16 px page gutters and
// the editor's border).
const NARROWEST = 286;

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

const attribute = (tag: string, name: string) =>
  tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];
const classesOf = (tag: string) => attribute(tag, "class")?.split(" ") ?? [];

// The bar's groups and strips as drawn: each box with its classes and its buttons (none of them
// holds a nested box).
function parts(html: string, kind: "group" | "strip") {
  return [
    ...html.matchAll(
      new RegExp(
        `(<div[^>]*data-${kind}="[^"]*"[^>]*>)([\\s\\S]*?)</div>`,
        "g",
      ),
    ),
  ].map(([, open, inner]) => ({
    id: attribute(open, `data-${kind}`) as GroupId,
    tag: open,
    buttons: [...inner.matchAll(/<button[^>]*>/g)].map(([tag]) => tag),
  }));
}

// What a bar this wide shows: per group in view, its buttons' labels and whether its "⋮" shows.
function drawnAt(html: string, width: number) {
  return parts(html, "group")
    .filter((group) => shownAt(classesOf(group.tag), width))
    .map((group) => {
      const shown = group.buttons.filter((tag) =>
        shownAt(classesOf(tag), width),
      );
      const more = shown.filter((tag) => attribute(tag, "aria-expanded"));
      return {
        id: group.id,
        direct: shown
          .filter((tag) => !attribute(tag, "aria-expanded"))
          .map((tag) => attribute(tag, "aria-label")),
        more: more.length,
      };
    });
}

// The labels a group's strip shows at this width, once it is open.
function stripAt(html: string, id: GroupId, width: number) {
  const strip = parts(html, "strip").find((part) => part.id === id);
  return (strip?.buttons ?? [])
    .filter((tag) => shownAt(classesOf(tag), width))
    .map((tag) => attribute(tag, "aria-label"));
}

const editorHtml = () => renderToStaticMarkup(withIntl(<Editor name="body" />));

test("each size has XenForo's groups, with its buttons and what each strip holds", () => {
  expect(layoutAt("xs").groups).toEqual([
    {
      id: "text",
      direct: ["bold", "italic"],
      more: [
        "underline",
        "strikethrough",
        "code",
        "heading",
        "bullet",
        "number",
      ],
    },
    {
      id: "insert",
      direct: ["link", "image"],
      more: ["media", "quote", "spoiler", "codeBlock"],
    },
    {
      id: "misc",
      direct: ["undo"],
      more: ["redo", "source", "removeFormatting"],
    },
  ]);
  expect(layoutAt("sm").groups).toEqual([
    {
      id: "text",
      direct: ["bold", "italic"],
      more: ["underline", "strikethrough", "code"],
    },
    { id: "paragraph", direct: ["bullet"], more: ["number", "heading"] },
    {
      id: "insert",
      direct: ["link", "image", "media"],
      more: ["quote", "spoiler", "codeBlock"],
    },
    {
      id: "misc",
      direct: ["undo"],
      more: ["redo", "source", "removeFormatting"],
    },
  ]);
  expect(layoutAt("md").groups).toEqual([
    {
      id: "text",
      direct: ["bold", "italic", "underline"],
      more: ["strikethrough", "code"],
    },
    { id: "paragraph", direct: ["bullet", "number", "heading"], more: [] },
    {
      id: "insert",
      direct: ["link", "image", "media"],
      more: ["quote", "spoiler", "codeBlock"],
    },
    {
      id: "misc",
      direct: ["undo"],
      more: ["redo", "source", "removeFormatting"],
    },
  ]);
  expect(layoutAt("lg").groups).toEqual([
    {
      id: "text",
      direct: [
        "removeFormatting",
        "bold",
        "italic",
        "underline",
        "strikethrough",
      ],
      more: ["code"],
    },
    { id: "paragraph", direct: ["bullet", "number", "heading"], more: [] },
    {
      id: "insert",
      direct: ["link", "image", "media", "quote", "spoiler", "codeBlock"],
      more: [],
    },
    { id: "misc", direct: ["undo", "redo", "source"], more: [] },
  ]);
});

const directAt = (size: ToolbarSize) =>
  layoutAt(size).groups.flatMap((group) => group.direct);

test("every command is in the bar exactly once at every size", () => {
  for (const size of TOOLBAR_SIZES) {
    const reachable = layoutAt(size).groups.flatMap((group) => [
      ...group.direct,
      ...group.more,
    ]);
    expect({ size, commands: reachable.sort() }).toEqual({
      size,
      commands: EVERY_COMMAND,
    });
  }
});

test("Bold, Italic, Link, Image and Undo are buttons at every size", () => {
  for (const size of TOOLBAR_SIZES) {
    for (const id of ["bold", "italic", "link", "image", "undo"] as const) {
      expect({ size, id, button: directAt(size).includes(id) }).toEqual({
        size,
        id,
        button: true,
      });
    }
  }
});

test("a smaller bar never shows a button that a larger one keeps behind its ⋮", () => {
  for (let index = 1; index < TOOLBAR_SIZES.length; index += 1) {
    const smaller = directAt(TOOLBAR_SIZES[index - 1]);
    const larger = directAt(TOOLBAR_SIZES[index]);
    for (const id of smaller) expect(larger).toContain(id);
  }
});

test("a group's box shows where it holds a button, and its ⋮ where its strip holds something", () => {
  for (const group of GROUPS) {
    for (const size of TOOLBAR_SIZES) {
      const at = (shown: Shown) => sizesOf(shown).includes(size);
      expect({
        group: group.id,
        size,
        box: at(group.shown),
        more: at(group.moreShown),
      }).toEqual({
        group: group.id,
        size,
        box: group.direct.some((slot) => at(slot.shown)),
        more: group.more.some((slot) => at(slot.shown)),
      });
    }
  }
});

test("the bar draws, at each width, the groups, buttons, ⋮ and strips of its size", () => {
  const html = editorHtml();
  for (const [size, width] of WIDTHS) {
    const groups = layoutAt(size).groups;
    expect({ width, drawn: drawnAt(html, width) }).toEqual({
      width,
      drawn: groups.map((group) => ({
        id: group.id,
        direct: group.direct.map((id) => LABELS[id]),
        more: group.more.length > 0 ? 1 : 0,
      })),
    });
    for (const group of groups) {
      expect({
        width,
        group: group.id,
        strip: stripAt(html, group.id, width),
      }).toEqual({
        width,
        group: group.id,
        strip: group.more.map((id) => LABELS[id]),
      });
    }
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

test("the groups of each size fit on one line of their narrowest bar, which wraps rather than scrolls", () => {
  // A button is 30 px wide and a ⋮ 22, each with 1 px on either side; a group's box adds 4 px of
  // padding and a 1 px border on either side; the boxes are 4 px apart and the bar's padding is
  // 6 px on either side.
  for (const size of TOOLBAR_SIZES) {
    const { groups } = layoutAt(size);
    const boxes = groups.map(
      (group) =>
        group.direct.length * 32 + (group.more.length > 0 ? 24 : 0) + 10,
    );
    const width =
      boxes.reduce((sum, box) => sum + box, 0) + (groups.length - 1) * 4 + 12;
    const narrowest = Math.max(SIZE_FROM[size], NARROWEST);
    expect({ size, width, fits: width <= narrowest }).toEqual({
      size,
      width,
      fits: true,
    });
  }
  const html = editorHtml();
  // The width the size is chosen from is the bar's own.
  expect(html).toMatch(/<div class="@container[^"]*"><div[^>]*role="toolbar"/);
  const bar = html.match(/role="toolbar"[^>]*class="([^"]*)"/)?.[1] ?? "";
  expect(bar.split(" ")).toContain("flex-wrap");
  expect(bar).not.toContain("overflow-x");
});

test("every control of the bar is a button of one toolbar, which the arrow keys move along", () => {
  const html = editorHtml();
  const bar = html.match(/<div[^>]*role="toolbar"[^>]*>/)?.[0] ?? "";
  expect(attribute(bar, "aria-label")).toBe(text.aria.formatting);
  expect(attribute(bar, "aria-orientation")).toBe("horizontal");
  const toolbar = html.slice(html.indexOf(bar));
  const controls = toolbar
    .slice(0, toolbar.indexOf('role="textbox"'))
    .match(/<(button|a|input|select)\b[^>]*>/g);
  for (const control of controls ?? []) {
    expect(control).toStartWith('<button type="button"');
    // One stop of the toolbar for Tab; the arrow keys go from button to button (Base UI's
    // roving focus, which skips the buttons the bar's size hides).
    expect(attribute(control, "tabindex")).toBe("-1");
  }
  for (const group of [...parts(html, "group"), ...parts(html, "strip")]) {
    expect(attribute(group.tag, "role")).toBe("group");
    expect(attribute(group.tag, "aria-label")).toBe(text.groups[group.id]);
  }
});

test("each ⋮ names its strip, which is closed until it is pressed; one strip is open at a time", () => {
  const html = editorHtml();
  const strips = parts(html, "strip");
  for (const group of parts(html, "group")) {
    const more = group.buttons.find((tag) => attribute(tag, "aria-expanded"));
    if (!more) continue;
    expect(attribute(more, "aria-label")).toBe(text.moreOptions);
    expect(attribute(more, "aria-expanded")).toBe("false");
    const strip = strips.find(
      (part) => attribute(part.tag, "id") === attribute(more, "aria-controls"),
    );
    expect(strip?.id).toBe(group.id);
    expect(classesOf(strip?.tag ?? "")).toContain("hidden");
  }
  expect(toggleStrip(null, "text")).toBe("text");
  expect(toggleStrip("text", "insert")).toBe("insert");
  expect(toggleStrip("insert", "insert")).toBeNull();
});

test("while the BB code source shows, only the button that leaves it works, in its strip too", () => {
  const html = renderToStaticMarkup(
    withIntl(
      <LexicalComposer
        initialConfig={{
          namespace: "test",
          onError: (error) => {
            throw error;
          },
        }}
      >
        <SourceContext.Provider
          value={{
            active: true,
            field: { current: null },
            commit: () => {},
            toggle: () => {},
          }}
        >
          <Toolbar />
        </SourceContext.Provider>
      </LexicalComposer>,
    ),
  );
  const buttons = [...html.matchAll(/<button[^>]*>/g)].map(([tag]) => tag);
  const usable = buttons
    .filter((tag) => attribute(tag, "aria-disabled") !== "true")
    .map(
      (tag) =>
        `${attribute(tag, "aria-label")}${
          attribute(tag, "aria-controls")?.endsWith("-misc") ? " (misc)" : ""
        }`,
    );
  // The source button of the large bar and of the misc strip, and the misc ⋮ that opens it.
  expect(usable.sort()).toEqual(
    [text.sourceLabel, text.sourceLabel, `${text.moreOptions} (misc)`].sort(),
  );
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
