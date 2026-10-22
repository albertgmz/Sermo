import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { renderToStaticMarkup } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { withIntl } from "@/lib/test-intl";
import { Editor } from "./editor";
import { SourceContext } from "./editor-extras";
import { Toolbar } from "./editor-toolbar";
import {
  ACTIVE_ON,
  activeMore,
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
  emoji: text.emojiPickerLabel,
  spoiler: text.spoilerLabel,
  codeBlock: text.codeBlockLabel,
  media: text.mediaLabel,
  source: text.sourceLabel,
  undo: text.undoLabel,
  redo: text.redoLabel,
};

const EVERY_COMMAND = Object.keys(LABELS).sort();

// The narrowest bar the toolbar is drawn in on one line: the comment column under a wall post on
// a 360 px phone (the thread reply of a 320 px phone, 286 px, is wider).
const NARROWEST = 270;

const moreOf = (id: GroupId) =>
  text.moreOptionsOf.replace("{group}", text.groups[id]);

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
        `(<fieldset[^>]*data-${kind}="[^"]*"[^>]*>)([\\s\\S]*?)</fieldset>`,
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
      more: ["emoji", "media", "quote", "spoiler", "codeBlock"],
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
      direct: ["link", "image", "emoji", "media"],
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
      direct: ["link", "image", "emoji", "media"],
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
      direct: [
        "link",
        "image",
        "emoji",
        "media",
        "quote",
        "spoiler",
        "codeBlock",
      ],
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
  // A button is 30 px wide with 1 px on either side, a ⋮ 24 px; a group's box adds 2 px of
  // padding and a 1 px border on either side; the boxes are 4 px apart and the bar's padding is
  // 4 px on either side.
  for (const size of TOOLBAR_SIZES) {
    const { groups } = layoutAt(size);
    const boxes = groups.map(
      (group) =>
        group.direct.length * 32 + (group.more.length > 0 ? 24 : 0) + 6,
    );
    const width =
      boxes.reduce((sum, box) => sum + box, 0) + (groups.length - 1) * 4 + 8;
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
  expect(bar.split(" ")).toContain("p-1");
  expect(bar.split(" ")).toContain("gap-1");
  for (const group of parts(html, "group")) {
    expect(classesOf(group.tag)).toContain("px-0.5");
  }
  expect(bar).not.toContain("overflow-x");
});

test("every control of the bar is a button of one toolbar, which the arrow keys move along", () => {
  const html = editorHtml();
  const bar = html.match(/<div[^>]*role="toolbar"[^>]*>/)?.[0] ?? "";
  expect(attribute(bar, "aria-label")).toBe(text.aria.formatting);
  expect(attribute(bar, "aria-orientation")).toBe("horizontal");
  // The bar itself is never in the Tab order: one of its buttons is (`placeStop`, put on the
  // page once the bar is drawn), so nothing can leave the bar out of it.
  expect(attribute(bar, "tabindex")).toBeUndefined();
  const toolbar = html.slice(html.indexOf(bar));
  const controls = toolbar
    .slice(0, toolbar.indexOf('role="textbox"'))
    .match(/<(button|a|input|select)\b[^>]*>/g);
  for (const control of controls ?? []) {
    expect(control).toStartWith('<button type="button"');
    // No button is a stop of its own: the arrow keys go from button to button
    // (`editor-toolbar-keys.test.ts`).
    expect(attribute(control, "tabindex")).toBe("-1");
  }
  // Each box and each strip is a named group (a fieldset), every name different.
  const names = [
    ...parts(html, "group").map((group) => {
      expect(attribute(group.tag, "aria-label")).toBe(text.groups[group.id]);
      return attribute(group.tag, "aria-label");
    }),
    ...parts(html, "strip").map((strip) => {
      expect(attribute(strip.tag, "aria-label")).toBe(moreOf(strip.id));
      return attribute(strip.tag, "aria-label");
    }),
  ];
  expect(new Set(names).size).toBe(names.length);
});

test("each ⋮ names its strip, which is closed until it is pressed; one strip is open at a time", () => {
  const html = editorHtml();
  const strips = parts(html, "strip");
  for (const group of parts(html, "group")) {
    const more = group.buttons.find((tag) => attribute(tag, "aria-expanded"));
    if (!more) continue;
    expect(attribute(more, "aria-label")).toBe(moreOf(group.id));
    // The pointer's tooltip names the group too.
    expect(attribute(more, "title")).toBe(moreOf(group.id));
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

test("an open strip is drawn only where its ⋮ is, and its ⋮ closes it while the BB code source shows", () => {
  // Read from the component: no strip is open in a page drawn on the server.
  const source = readFileSync(
    join(import.meta.dir, "editor-toolbar.tsx"),
    "utf8",
  );
  expect(source).toMatch(
    /open === group\.id\s*\?\s*cn\("flex", SHOWN\[group\.moreShown\]\)\s*:\s*"hidden"/,
  );
  expect(source).toContain("more.every(unavailable) && !expanded");
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
    .map((tag) => attribute(tag, "aria-label"));
  // The source button of the large bar and of the misc strip, and the misc ⋮ that opens it.
  expect(usable.sort()).toEqual(
    [text.sourceLabel, text.sourceLabel, moreOf("misc")].sort(),
  );
});

test("a command that is on is told from a hovered one by more than a colour: a tint, the accent's ink and a ring", () => {
  const html = editorHtml();
  const bold = html.match(
    new RegExp(`<button[^>]*aria-label="${text.boldLabel}"[^>]*>`),
  )?.[0];
  const classes = classesOf(bold ?? "");
  expect(attribute(bold ?? "", "aria-pressed")).toBe("false");
  for (const name of [
    "aria-pressed:bg-primary/10",
    "aria-pressed:text-primary-ink",
    "aria-pressed:ring-1",
    "aria-pressed:ring-inset",
    "aria-pressed:ring-primary-ink",
    "hover:bg-muted",
  ]) {
    expect(classes).toContain(name);
  }
  expect(classes).not.toContain("aria-pressed:bg-muted");
  // The focus is an outline, a property the pressed state does not set: a focused command that
  // is on keeps its focus ring (two rings would share one property, and the later rule wins).
  for (const name of [
    "focus-visible:outline-2",
    "focus-visible:outline-solid",
    "focus-visible:outline-ring",
  ]) {
    expect(classes).toContain(name);
  }
  const property = (name: string) =>
    name
      .split(":")
      .at(-1)
      ?.match(/^(ring|outline|bg|text)/)?.[1];
  const focus = classes.filter((name) => name.startsWith("focus-visible:"));
  const pressed = classes.filter((name) => name.startsWith("aria-pressed:"));
  for (const name of focus) {
    expect(pressed.map(property)).not.toContain(property(name));
  }
  // The ⋮ is 24 px wide, WCAG's least target.
  const more = html.match(/<button[^>]*aria-expanded[^>]*>/)?.[0] ?? "";
  expect(classesOf(more)).toContain("w-6");
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

// Whether a "⋮" with these classes is drawn as holding a command that is on, in a bar this wide:
// a class that sets the full opacity, under container queries the width meets.
function activeAt(classes: string[], width: number) {
  return classes.some((name) => {
    const parts = name.split(":");
    if (parts.at(-1) !== "opacity-100") return false;
    return parts.slice(0, -1).every((variant) => {
      const query = variant.match(/^@(min|max)-\[(\d+)px\]$/);
      if (!query) return false;
      const edge = Number(query[2]);
      return query[1] === "min" ? width >= edge : width <= edge;
    });
  });
}

test("a ⋮ looks active only at the widths where its strip holds the command that is on", () => {
  const text = GROUPS.find((group) => group.id === "text");
  const insert = GROUPS.find((group) => group.id === "insert");
  if (!text || !insert) throw new Error("no text or insert group");
  const on = (ids: CommandId[]) => (id: CommandId) => ids.includes(id);
  // A list or a heading is in the text strip at extra small only; from 420 px it is a button of
  // the paragraph group or in its own strip, so the text ⋮ stays quiet there.
  for (const id of ["bullet", "number", "heading"] as const) {
    const classes = activeMore(text.more, on([id])).split(" ");
    expect({
      id,
      at: [419, 420, 575, 900].map((w) => activeAt(classes, w)),
    }).toEqual({ id, at: [true, false, false, false] });
  }
  // Inline code is in the text strip at every width.
  const code = activeMore(text.more, on(["code"])).split(" ");
  expect([300, 600, 1200].map((w) => activeAt(code, w))).toEqual([
    true,
    true,
    true,
  ]);
  // Strikethrough up to medium, a button at large.
  const strike = activeMore(text.more, on(["strikethrough"])).split(" ");
  expect([574, 899, 900].map((w) => activeAt(strike, w))).toEqual([
    true,
    true,
    false,
  ]);
  // Nothing on: never active. A command of another strip: not this one's.
  expect(activeMore(text.more, on([]))).toBe("");
  expect(activeMore(insert.more, on(["bold"]))).toBe("");
});

test("the active classes of each size range switch exactly where the range's sizes do", () => {
  for (const shown of Object.keys(ACTIVE_ON) as Shown[]) {
    for (const [size, width] of WIDTHS) {
      expect({
        shown,
        width,
        on: activeAt(ACTIVE_ON[shown].split(" "), width),
      }).toEqual({ shown, width, on: sizesOf(shown).includes(size) });
    }
  }
});

test("with nothing on, no ⋮ is drawn active, and the bar takes no classes from outside", () => {
  const html = editorHtml();
  for (const group of parts(html, "group")) {
    const more = group.buttons.find((tag) => attribute(tag, "aria-expanded"));
    if (!more) continue;
    expect(classesOf(more)).toContain("opacity-50");
    expect(
      classesOf(more).some(
        (name) =>
          name.endsWith("opacity-100") && !name.startsWith("aria-expanded:"),
      ),
    ).toBe(false);
    expect(more).not.toContain("data-active");
  }
  const source = readFileSync(
    join(import.meta.dir, "editor-toolbar.tsx"),
    "utf8",
  );
  expect(source).toContain("export function Toolbar() {");
  expect(source).toMatch(
    /activeMore\(\s*group\.more,\s*\(id\) => commands\[id\]\.active === true,?\s*\)/,
  );
});
