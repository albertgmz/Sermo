import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { withColorGuard } from "./color-guard";

test("a typed colour becomes a variable the stylesheet holds between the bounds of the theme", () => {
  expect(
    withColorGuard('<p><span style="color:#ff0000">red</span> and plain</p>'),
  ).toBe(
    '<p><span class="bb-color" style="--ink:#ff0000">red</span> and plain</p>',
  );
  expect(withColorGuard('<span style="color:#fff">a</span>')).toBe(
    '<span class="bb-color" style="--ink:#fff">a</span>',
  );
  expect(withColorGuard('<span style="color:navy">a</span>')).toBe(
    '<span class="bb-color" style="--ink:navy">a</span>',
  );
  expect(withColorGuard('<span style="color: #000;">a</span>')).toBe(
    '<span class="bb-color" style="--ink:#000">a</span>',
  );
});

test("nested colours each get their own", () => {
  expect(
    withColorGuard(
      '<span style="color:red">a<span style="color:blue">b</span></span>',
    ),
  ).toBe(
    '<span class="bb-color" style="--ink:red">a<span class="bb-color" style="--ink:blue">b</span></span>',
  );
});

test("anything else in a style is left as it is", () => {
  for (const html of [
    "<p>no colour</p>",
    '<span style="color:red;position:fixed">a</span>',
    '<span style="color:url(x)">a</span>',
    '<span style="background:red">a</span>',
    '<span style="color:#12">a</span>',
    '<span class="x" style="color:red">a</span>',
  ])
    expect(withColorGuard(html)).toBe(html);
});

test("the stylesheet draws a guarded colour between the accent's bounds, with a plain fallback", () => {
  const css = readFileSync(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );
  expect(css).toMatch(
    /\.bb-content \.bb-color \{\s*color: oklch\(\s*from var\(--ink\) clamp\(var\(--accent-min\), l, var\(--ink-max\)\) c h\s*\);/,
  );
  expect(css).toMatch(
    /\.ink,\s*\.bb-content \.bb-color \{\s*color: var\(--ink\);/,
  );
});
