import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import { Editor } from "./editor";
import { LazyEditor } from "./lazy-editor";

// XenForo's editor (fcuba's style), as measured on the forum's quick reply. The
// colours are Sermo's tokens in the roles XenForo gives its own: the box is the muted fill and
// turns the card's while it is written in, the bar is a band of the border colour that clears on
// focus, and its groups are card-filled segments whose border shows only then.

const classesOf = (tag: string) =>
  tag.match(/class="([^"]*)"/)?.[1].split(" ") ?? [];
const tagWith = (html: string, pattern: RegExp) =>
  html.match(pattern)?.[0] ?? "";
const expectClasses = (tag: string, names: string[]) => {
  const classes = classesOf(tag);
  for (const name of names)
    expect({ name, has: classes.includes(name) }).toEqual({ name, has: true });
};

const editorHtml = () =>
  renderToStaticMarkup(
    withIntl(<Editor name="body" placeholder="Escribe la respuesta…" />),
  );

// The box: a 1 px border and a 9 px radius; muted at rest, the card's fill while the caret is in it;
// its border keeps its colour (XenForo's focus is the fill and the groups' borders).
const BOX = ["rounded-[9px]", "border", "bg-muted", "focus-within:bg-card"];

test("the editor's box has XenForo's border, radius and fills", () => {
  const html = editorHtml();
  const box = tagWith(html, /<div class="group\/editor[^"]*"/);
  expectClasses(box, BOX);
  expect(classesOf(box)).not.toContain("focus-within:border-ring");
  expect(classesOf(box)).not.toContain("rounded-lg");
});

test("the bar is 55 px: 6 px of padding around 42 px segments, 3 px apart, a band that clears on focus", () => {
  const html = editorHtml();
  const bar = tagWith(html, /<div[^>]*role="toolbar"[^>]*>/);
  expectClasses(bar, [
    "p-1.5",
    "gap-[3px]",
    "border-b",
    "bg-border",
    "group-focus-within/editor:bg-transparent",
  ]);
  // A segment: 1 px border + 2 px padding + a 32 px button between 2 px margins = 42 px.
  const groups = [...html.matchAll(/<fieldset[^>]*data-group="[^"]*"[^>]*>/g)];
  expect(groups.length).toBeGreaterThan(0);
  for (const [group] of groups) {
    expectClasses(group, [
      "rounded-[9px]",
      "border",
      "bg-card",
      "px-1.5",
      "py-0.5",
    ]);
    expect(group).not.toContain("border-dashed");
  }
});

test("a button is 30 x 32 px between 2 px and 1 px margins, 4 px round, borderless, filled with the border colour under the pointer", () => {
  const html = editorHtml();
  const bold = tagWith(html, /<button[^>]*aria-pressed[^>]*>/);
  expectClasses(bold, [
    "h-8",
    "w-[30px]",
    "my-0.5",
    "mx-px",
    "rounded-[4px]",
    "hover:bg-border",
    "hover:text-foreground",
  ]);
  expect(classesOf(bold).some((name) => /^border(-|$)/.test(name))).toBe(false);
});

// The text: 10 px 20 px 20 px of padding, 16 px / 22.4 px on a phone (no zoom on iOS) and
// 15 px / 21 px from a tablet up, at least 100 px tall; the placeholder in the same place, the
// text's colour at 40 %.
const TEXT = [
  "pt-2.5",
  "px-5",
  "pb-5",
  "text-base",
  "leading-[1.4]",
  "md:text-[15px]",
  "md:leading-[21px]",
];

test("the text area has XenForo's padding, type and least height, and the placeholder its 40 % ink", () => {
  const html = editorHtml();
  const text = tagWith(html, /<div[^>]*role="textbox"[^>]*>/);
  expectClasses(text, TEXT);
  expect(text).toContain("min-height:100px");
  const placeholder = tagWith(html, /<div[^>]*>Escribe la respuesta…<\/div>/);
  expectClasses(placeholder, [...TEXT, "text-foreground/40"]);
});

test("the plain box before the editor loads looks the same, so nothing moves", () => {
  const html = renderToStaticMarkup(
    <LazyEditor
      name="body"
      placeholder="Escribe la respuesta…"
      compact={false}
    />,
  );
  expectClasses(tagWith(html, /<div[^>]*>/), BOX);
  const field = tagWith(html, /<textarea[^>]*>/);
  expectClasses(field, [...TEXT, "placeholder:text-foreground/40"]);
  expect(field).toContain("min-height:100px");
});

// The Create flow's sheet is the one place the box has no frame: its text fills the screen. It
// stays clear there while written in, rather than turning the card's colour.
test("the whole-screen composer keeps its frameless box clear while written in", () => {
  const source = readFileSync(join(import.meta.dir, "composer.tsx"), "utf8");
  expect(source).toContain(
    '"rounded-none border-0 bg-transparent focus-within:bg-transparent"',
  );
});
