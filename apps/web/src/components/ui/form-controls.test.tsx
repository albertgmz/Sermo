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
