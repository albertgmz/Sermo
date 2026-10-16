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

// The buttons that set their own colours by role: Accept all green, Reject all red, Choose a
// quiet outline. A button's own value comes before the sheet's.
const role = (name: string) =>
  declarations(
    new RegExp(
      String.raw`^#cc-main \[data-role="${name}"\]\s*\{([^}]*)\}`,
      "gm",
    ),
  );

function colour(
  tokens: Map<string, string>,
  name: string,
  own: Map<string, string> = new Map(),
): string {
  const find = (key: string) =>
    own.get(key) ?? banner.get(key) ?? tokens.get(key);
  let value: string | undefined = find(name);
  const seen = new Set<string>();
  while (value?.startsWith("var(")) {
    const next = value.slice(4, -1).trim();
    if (seen.has(next)) break;
    seen.add(next);
    value = find(next);
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

const PRIMARY: [string, string, number][] = [
  ["--cc-btn-primary-color", "--cc-btn-primary-bg", TEXT],
  ["--cc-btn-primary-hover-color", "--cc-btn-primary-hover-bg", TEXT],
];
const SECONDARY: [string, string, number][] = [
  ["--cc-btn-secondary-color", "--cc-btn-secondary-bg", TEXT],
  ["--cc-btn-secondary-hover-color", "--cc-btn-secondary-hover-bg", TEXT],
];
// [role, the pairs its button draws, the variable of its fill, the token it fills with]
const BUTTONS: [string, [string, string, number][], string, string][] = [
  ["all", PRIMARY, "--cc-btn-primary-bg", "--consent-accept"],
  ["necessary", PRIMARY, "--cc-btn-primary-bg", "--consent-reject"],
  ["show", SECONDARY, "--cc-btn-secondary-bg", "--popover"],
];

test("accept is green, reject red, and choose an outline on the sheet's own surface", () => {
  for (const [name, , fill, token] of BUTTONS)
    expect(role(name).get(fill), name).toBe(`var(${token})`);
  expect(banner.get("--cc-bg")).toBe("var(--popover)");
});

for (const [theme, tokens] of [
  ["dark", dark],
  ["light", light],
] as const) {
  test(`the banner's buttons are legible in the ${theme} theme`, () => {
    for (const [name, pairs] of BUTTONS) {
      const own = role(name);
      for (const [fg, bg, least] of pairs) {
        const got = ratio(colour(tokens, fg, own), colour(tokens, bg, own));
        expect(
          got,
          `${name}: ${fg} on ${bg}: ${got.toFixed(2)}`,
        ).toBeGreaterThanOrEqual(least);
      }
    }
  });

  test(`the banner's text and toggles are legible in the ${theme} theme`, () => {
    for (const [fg, bg, least] of PAIRS) {
      const got = ratio(colour(tokens, fg), colour(tokens, bg));
      expect(got, `${fg} on ${bg}: ${got.toFixed(2)}`).toBeGreaterThanOrEqual(
        least,
      );
    }
  });
}
