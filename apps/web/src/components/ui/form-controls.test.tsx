import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { EDITOR_BOX } from "@/components/forum/composer-box";
import { Button } from "./button";
import { FIELD_FILL, FIELD_SURFACE } from "./field-surface";
import { Input } from "./input";
import { SELECT_TRIGGER } from "./select-trigger-class";
import { Textarea } from "./textarea";

const classesOf = (html: string) =>
  html.match(/class="([^"]*)"/)?.[1].split(" ") ?? [];

test("a destructive button is solid, so a confirming Delete does not read as a disabled one", () => {
  const classes = classesOf(
    renderToStaticMarkup(<Button variant="destructive">Delete</Button>),
  );
  expect(classes).toContain("bg-destructive");
  expect(classes).toContain("text-background");
  expect(classes).not.toContain("bg-destructive/10");
});

test("an input, a textarea, a select's button and the editor's box share one fill, and the first three one edge, in both themes", () => {
  const surface = FIELD_SURFACE.split(" ");
  const controls = [
    classesOf(renderToStaticMarkup(<Input name="title" />)),
    classesOf(renderToStaticMarkup(<Textarea name="body" />)),
    SELECT_TRIGGER.split(" "),
  ];
  for (const classes of controls) {
    for (const name of surface) expect(classes).toContain(name);
    expect(classes).not.toContain("bg-transparent");
    expect(classes).not.toContain("dark:bg-input/30");
  }
  expect(EDITOR_BOX.split(" ")).toContain(FIELD_FILL);
  expect(FIELD_FILL).toBe("bg-card");
});

test("checkboxes and radios take the accent, in both themes", () => {
  const css = readFileSync(
    new URL("../../app/globals.css", import.meta.url),
    "utf8",
  );
  expect(css).toMatch(
    /input\[type="checkbox"\],\s*input\[type="radio"\]\s*\{\s*accent-color: var\(--primary\);\s*\}/,
  );
});

// A text field or select drawn by hand with its own edge and fill (`border-input` with
// `bg-transparent` or `dark:bg-input/30`) is a surface that drifts from the shared controls: it
// takes `FIELD_SURFACE` instead. Left out, and why: buttons, checkboxes, toggles and the colour
// swatch are not text fields; the new thread's title field (`thread-fields.tsx`) keeps the well of
// its own tokens (`bg-field`, `border-field-border`, an edge held at 3:1 by theme-contrast, as the
// owner found it did not stand out), and its unused `default` look keeps the old fill.
const NOT_FIELDS = [
  "components/ui/button.tsx",
  "components/ui/checkbox.tsx",
  "components/ui/toggle.tsx",
  "components/forum/thread-fields.tsx",
  "app/[locale]/(staff)/admin/appearance/colour-rows.tsx",
];

test("no text field or select is drawn by hand with its own fill", () => {
  const root = new URL("../../", import.meta.url).pathname;
  const found: string[] = [];
  for (const path of new Bun.Glob("**/*.{ts,tsx}").scanSync(root)) {
    if (/\.test\.tsx?$/.test(path) || NOT_FIELDS.includes(path)) continue;
    const source = readFileSync(`${root}${path}`, "utf8");
    for (const [text] of source.matchAll(
      /["`][^"`\n]*border-input[^"`\n]*["`]/g,
    )) {
      if (/\bbg-transparent\b|dark:bg-input\/30/.test(text)) {
        found.push(`${path}: ${text.slice(0, 70)}`);
      }
    }
  }
  expect(found).toEqual([]);
});
