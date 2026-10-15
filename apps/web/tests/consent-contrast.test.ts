import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// The cookie banner draws the library's sheet with the site's tokens (`#cc-main` in globals.css).
// The tokens it maps to pass the theme rules on their own; this holds the pairs the banner puts
// together (text on its surface, a toggle on its track) to the WCAG ratios in both themes.
const css = readFileSync(
  new URL("../src/app/globals.css", import.meta.url),
  "utf8",
);

function declarations(selector: RegExp) {
  const found = new Map<string, string>();
  for (const block of css.matchAll(selector)) {
    for (const line of (block[1] ?? "").matchAll(/(--[\w-]+):\s*([^;]+);/g))
      found.set(line[1] as string, (line[2] as string).trim());
  }
  return found;
}

const dark = declarations(/^:root\s*\{([^}]*)\}/gm);
const light = new Map([
  ...dark,
  ...declarations(/^:root\[data-theme="light"\]\s*\{([^}]*)\}/gm),
]);
const banner = declarations(/^#cc-main\s*\{([^}]*)\}/gm);

function colour(tokens: Map<string, string>, name: string): string {
  let value: string | undefined = banner.get(name) ?? tokens.get(name);
  const seen = new Set<string>();
  while (value?.startsWith("var(")) {
    const next = value.slice(4, -1).trim();
    if (seen.has(next)) break;
    seen.add(next);
    value = banner.get(next) ?? tokens.get(next);
  }
  if (!value || !/^#[0-9a-f]{6}$/i.test(value))
    throw new Error(`${name} is not a plain #rrggbb colour: ${value}`);
  return value;
}

const channel = (hex: string, at: number) => {
  const c = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) =>
  0.2126 * channel(hex, 1) +
  0.7152 * channel(hex, 3) +
  0.0722 * channel(hex, 5);
function ratio(a: string, b: string) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (high + 0.05) / (low + 0.05);
}

// [text or icon, what it sits on, the least ratio]
const TEXT = 4.5;
const SHAPE = 3;
const PAIRS: [string, string, number][] = [
  ["--cc-primary-color", "--cc-bg", TEXT],
  ["--cc-secondary-color", "--cc-bg", TEXT],
  ["--cc-btn-primary-color", "--cc-btn-primary-bg", TEXT],
  ["--cc-btn-primary-hover-color", "--cc-btn-primary-hover-bg", TEXT],
  ["--cc-btn-secondary-color", "--cc-btn-secondary-bg", TEXT],
  ["--cc-btn-secondary-hover-color", "--cc-btn-secondary-hover-bg", TEXT],
  ["--cc-primary-color", "--cc-cookie-category-block-bg", TEXT],
  ["--cc-secondary-color", "--cc-cookie-category-block-bg", TEXT],
  ["--cc-primary-color", "--cc-cookie-category-block-hover-bg", TEXT],
  ["--cc-primary-color", "--cc-cookie-category-expanded-block-hover-bg", TEXT],
  ["--cc-footer-color", "--cc-footer-bg", TEXT],
  ["--cc-toggle-off-bg", "--cc-bg", SHAPE],
  ["--cc-toggle-on-bg", "--cc-bg", SHAPE],
  ["--cc-toggle-off-knob-bg", "--cc-toggle-off-bg", SHAPE],
  ["--cc-toggle-on-knob-bg", "--cc-toggle-on-bg", SHAPE],
  ["--cc-toggle-enabled-icon-color", "--cc-toggle-on-knob-bg", SHAPE],
  ["--cc-toggle-disabled-icon-color", "--cc-toggle-off-knob-bg", SHAPE],
  ["--cc-toggle-readonly-knob-bg", "--cc-toggle-readonly-bg", SHAPE],
  [
    "--cc-toggle-readonly-knob-icon-color",
    "--cc-toggle-readonly-knob-bg",
    SHAPE,
  ],
];

test("the banner's variables are all set on #cc-main", () => {
  expect(banner.size).toBeGreaterThan(30);
  for (const [fg, bg] of PAIRS) {
    expect(banner.has(fg), fg).toBe(true);
    expect(banner.has(bg), bg).toBe(true);
  }
});

for (const [theme, tokens] of [
  ["dark", dark],
  ["light", light],
] as const) {
  test(`the banner's text and toggles are legible in the ${theme} theme`, () => {
    for (const [fg, bg, least] of PAIRS) {
      const got = ratio(colour(tokens, fg), colour(tokens, bg));
      expect(got, `${fg} on ${bg}: ${got.toFixed(2)}`).toBeGreaterThanOrEqual(
        least,
      );
    }
  });
}
