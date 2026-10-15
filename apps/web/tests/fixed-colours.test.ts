import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// Colours come from the tokens in globals.css so both themes keep working. The styleguide draws
// sample art with fixed colours, the admin colour input needs a #rrggbb value to start from, and
// the web app manifest is read by the operating system, which knows no CSS variables.
const ALLOWED = [
  "lib/pwa.ts",
  "app/[locale]/(main)/ui/samples.ts",
  "app/[locale]/(staff)/admin/appearance/colour-rows.tsx",
];

const FIXED =
  /\b(?:bg|text|border|ring|fill|stroke|from|via|to|outline|shadow|divide|decoration)-(?:black|white)\b|#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab)\(/gi;

const root = new URL("../src", import.meta.url).pathname.replace(
  /^\/(?=[a-z]:)/i,
  "",
);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [path]
      : [];
  });
}

test("no fixed colour is written outside the tokens", () => {
  const found: string[] = [];
  for (const file of sources(decodeURIComponent(root))) {
    const name = relative(decodeURIComponent(root), file).replaceAll("\\", "/");
    if (ALLOWED.includes(name)) continue;
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, index) => {
        if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return;
        for (const match of line.matchAll(FIXED)) {
          found.push(`${name}:${index + 1} ${match[0]}`);
        }
      });
  }
  expect(found).toEqual([]);
});
