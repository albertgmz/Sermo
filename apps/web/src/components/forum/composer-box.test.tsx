import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import { Editor } from "./editor";
import { LazyEditor } from "./lazy-editor";
import { EditorSkeleton } from "./skeletons";

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
    withIntl(
      <LazyEditor
        name="body"
        placeholder="Escribe la respuesta…"
        compact={false}
      />,
    ),
  );
  expectClasses(tagWith(html, /<div[^>]*>/), BOX);
  const field = tagWith(html, /<textarea[^>]*>/);
  expectClasses(field, [...TEXT, "placeholder:text-foreground/40"]);
  expect(field).toContain("min-height:100px");
});

// The Create flow's sheet and a thread's own page are the place the box has no frame: its text
// fills the screen. It stays clear there while written in, rather than turning the card's colour.
test("the whole-screen composer keeps its frameless box clear while written in", async () => {
  mock.module("server-only", () => ({}));
  const { ComposerForm } = await import("./composer");
  const html = renderToStaticMarkup(
    withIntl(
      <ComposerForm
        onSubmit={() => {}}
        frame={{ kind: "page", closeHref: "/forums/2" }}
        submitLabel="Post"
        pending={false}
        placeholder="Write"
      />,
    ),
  );
  const box =
    html.match(/<div class="(group\/editor[^"]*)"/)?.[1].split(" ") ?? [];
  for (const name of [
    "border-0",
    "bg-transparent",
    "focus-within:bg-transparent",
  ])
    expect(box).toContain(name);
  expect(box).not.toContain("bg-muted");
  expect(box).not.toContain("focus-within:bg-card");
});

// An open ⋮ strip lies on the bar itself: the band clears while one is open, so a button's hover
// fill (the border colour) shows there too.
test("the bar's band clears while a strip is open", () => {
  const bar = tagWith(editorHtml(), /<div[^>]*role="toolbar"[^>]*>/);
  expectClasses(bar, ["has-[[aria-expanded=true]]:bg-transparent"]);
});

// The page's loading shape of a composer is the box it stands in for: the same frame, fills, bar
// and text room, so nothing changes colour or size when the page arrives.
test("the editor's loading shape is the editor's box, bar and text room", () => {
  const html = renderToStaticMarkup(<EditorSkeleton />);
  expectClasses(tagWith(html, /<div[^>]*>/), BOX);
  expectClasses(tagWith(html, /<div[^>]*class="[^"]*border-b[^"]*"[^>]*>/), [
    "p-1.5",
    "gap-[3px]",
    "bg-border",
  ]);
  const segments = [...html.matchAll(/<div class="[^"]*h-\[42px\][^"]*"/g)];
  expect(segments.length).toBeGreaterThan(0);
  for (const [segment] of segments)
    expectClasses(`${segment}>`, ["rounded-[9px]", "border", "bg-card"]);
  const body = tagWith(html, /<div[^>]*min-height[^>]*>/);
  expect(body).toContain("min-height:100px");
  expect(renderToStaticMarkup(<EditorSkeleton minHeight={200} />)).toContain(
    "min-height:200px",
  );
});
