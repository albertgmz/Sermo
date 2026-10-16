import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ACCENTS,
  BADGES,
  NAME_COLORS,
  PREFIXES,
} from "../src/app/[locale]/(main)/ui/samples";

// The colour tokens of globals.css, per theme: the root block holds the dark values, the
// data-theme="light" block overrides the ones that differ.
const css = readFileSync(
  new URL("../src/app/globals.css", import.meta.url),
  "utf8",
);

function declarations(selector: RegExp) {
  const found = new Map<string, string>();
  for (const block of css.matchAll(selector)) {
    for (const line of (block[1] ?? "").matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
      found.set(line[1] as string, (line[2] as string).trim());
    }
  }
  return found;
}

const dark = declarations(/^:root\s*\{([^}]*)\}/gm);
const light = new Map([
  ...dark,
  ...declarations(/^:root\[data-theme="light"\]\s*\{([^}]*)\}/gm),
]);

function resolve(tokens: Map<string, string>, name: string): string {
  let value = tokens.get(`--${name}`);
  const seen = new Set<string>();
  while (value?.startsWith("var(")) {
    const next = value.slice(4, -1).trim();
    if (seen.has(next)) break;
    seen.add(next);
    value = tokens.get(next);
  }
  if (!value || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`${name} is not a plain #rrggbb colour: ${value}`);
  }
  return value;
}

// color-mix is not needed; the stylesheet holds a colour's lightness (OKLab L, the same as OKLCH
// L) between two bounds and keeps hue and chroma, shrinking chroma when the result leaves sRGB.
const toLinear = (channel: number) =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
const fromLinear = (channel: number) =>
  channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;

function toOklab(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((at) =>
    toLinear(Number.parseInt(hex.slice(at, at + 2), 16) / 255),
  ) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab(L: number, a: number, b: number) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function hold(hex: string, min: number, max: number) {
  const [L, a, b] = toOklab(hex);
  const held = Math.min(max, Math.max(min, L));
  let scale = 1;
  let low = 0;
  let high = 1;
  const inside = (k: number) =>
    fromOklab(held, a * k, b * k).every((c) => c >= -0.0005 && c <= 1.0005);
  if (!inside(1)) {
    for (let step = 0; step < 30; step++) {
      scale = (low + high) / 2;
      if (inside(scale)) low = scale;
      else high = scale;
    }
    scale = low;
  }
  return (
    "#" +
    fromOklab(held, a * scale, b * scale)
      .map((c) =>
        Math.round(Math.min(1, Math.max(0, fromLinear(Math.max(0, c)))) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

const number = (tokens: Map<string, string>, name: string) =>
  Number.parseFloat(tokens.get(name) ?? "NaN");

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const channel = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (high + 0.05) / (low + 0.05);
}

const SURFACES = ["background", "card", "popover"];
const TEXT = [
  "foreground",
  "card-foreground",
  "popover-foreground",
  "muted-foreground",
];
const CODE = [
  "code-comment",
  "code-keyword",
  "code-string",
  "code-number",
  "code-title",
  "code-builtin",
  "code-attribute",
  "code-meta",
  "code-addition",
  "code-deletion",
];

// [text token, surface tokens, minimum ratio]
const PAIRS: [string[], string[], number][] = [
  [TEXT, SURFACES, 4.5],
  [["muted-foreground", "foreground"], ["muted", "secondary", "accent"], 4.5],
  [["secondary-foreground"], ["secondary"], 4.5],
  [["accent-foreground"], ["accent"], 4.5],
  [["primary-foreground"], ["primary"], 4.5],
  [["destructive", "success"], SURFACES, 4.5],
  [
    ["consent-accept-foreground"],
    ["consent-accept", "consent-accept-hover"],
    4.5,
  ],
  [
    ["consent-reject-foreground"],
    ["consent-reject", "consent-reject-hover"],
    4.5,
  ],
  [
    ["tier-bronze", "tier-silver", "tier-gold", "tier-legendary"],
    ["card"],
    4.5,
  ],
  [CODE, ["card", "muted"], 4.5],
];

for (const [theme, tokens] of [
  ["dark", dark],
  ["light", light],
] as const) {
  test(`${theme} theme: text and accents are readable on their surfaces`, () => {
    const failures: string[] = [];
    for (const [texts, surfaces, minimum] of PAIRS) {
      for (const text of texts) {
        for (const surface of surfaces) {
          const ratio = contrast(
            resolve(tokens, text),
            resolve(tokens, surface),
          );
          if (ratio < minimum) {
            failures.push(
              `${text} on ${surface}: ${ratio.toFixed(2)} < ${minimum}`,
            );
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });
}

const palette = (colours: (string | null)[]) =>
  colours.filter((colour): colour is string => colour !== null);

for (const [theme, tokens] of [
  ["dark", dark],
  ["light", light],
] as const) {
  test(`${theme} theme: every preset accent reads as text, link and ring`, () => {
    const failures: string[] = [];
    const accents = [...ACCENTS.map((accent) => accent.color), "#dc2626"];
    for (const accent of accents) {
      const ink = hold(
        accent,
        number(tokens, "--accent-min"),
        number(tokens, "--ink-max"),
      );
      for (const surface of SURFACES) {
        // The ring has to reach 3, text and links 4.5: the ring is the same colour.
        const ratio = contrast(ink, resolve(tokens, surface));
        if (ratio < 4.5) {
          failures.push(
            `${accent} -> ${ink} on ${surface}: ${ratio.toFixed(2)}`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });

  test(`${theme} theme: names, prefixes and badges chosen by administrators`, () => {
    const colours = palette([
      ...NAME_COLORS.map((colour) => colour.color),
      ...PREFIXES.map((prefix) => prefix.color),
      ...BADGES.map((badge) => badge.color),
    ]);
    const failures: string[] = [];
    for (const colour of colours) {
      const ink = hold(
        colour,
        number(tokens, "--ink-min"),
        number(tokens, "--ink-max"),
      );
      if (theme === "dark") {
        if (ink !== colour) failures.push(`${colour} changed to ${ink}`);
        continue;
      }
      for (const surface of ["card", "background"]) {
        const ratio = contrast(ink, resolve(tokens, surface));
        if (ratio < 4.5) {
          failures.push(
            `${colour} -> ${ink} on ${surface}: ${ratio.toFixed(2)}`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });
}

test("browsers without relative colours get plain colours", () => {
  const relative = [
    ...css.matchAll(/^\s*(--[\w-]+|color):\s*oklch\(\s*from/gm),
  ].map((match) => match[1]);
  expect(new Set(relative)).toEqual(new Set(["--primary-ink", "color"]));
  const fallback = css.slice(
    css.indexOf("@supports not (color: oklch(from red l c h))"),
  );
  expect(fallback).toContain("--primary-ink: var(--primary);");
  expect(fallback).toContain("color: var(--ink);");
  expect(fallback).toContain(".accent-scope");
});

test("skeletons show against the card on the light theme", () => {
  expect(
    contrast(resolve(light, "skeleton"), resolve(light, "card")),
  ).toBeGreaterThanOrEqual(1.2);
});

test("the light theme gives every colour token a value of its own", () => {
  const lightOnly = declarations(
    /^:root\[data-theme="light"\]\s*\{([^}]*)\}/gm,
  );
  const missing = [...dark.keys()].filter(
    (name) =>
      /^--(background|card|popover|secondary|muted|accent|overlay|skeleton|foreground|card-foreground|popover-foreground|secondary-foreground|muted-foreground|accent-foreground|border|input|destructive|success|consent-.+|chart-[1345]|tier-.+|code-.+)$/.test(
        name,
      ) && !lightOnly.has(name),
  );
  expect(missing).toEqual([]);
});
