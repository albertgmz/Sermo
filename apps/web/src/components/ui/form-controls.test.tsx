import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "./button";
import { Input } from "./input";

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

test("a text input is filled with the card, as the editor's box is, in both themes", () => {
  const classes = classesOf(renderToStaticMarkup(<Input name="title" />));
  expect(classes).toContain("bg-card");
  expect(classes).not.toContain("bg-transparent");
  expect(classes).not.toContain("dark:bg-input/30");
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
