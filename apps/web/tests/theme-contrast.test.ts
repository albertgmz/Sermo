import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

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
    ["tier-bronze", "tier-silver", "tier-gold", "tier-legendary"],
    ["card"],
    4.5,
  ],
  [CODE, ["card", "muted"], 4.5],
  [["ring"], SURFACES, 3],
];

for (const [theme, tokens] of [
  ["dark", dark],
  ["light", light],
] as const) {
  test(`${theme} theme: text and accents are readable on their surfaces`, () => {
    const failures: string[] = [];
    // The accent is both the fill that white text sits on and the colour of links. On the dark
    // surfaces no red does both at 4.5 (white on it needs a dark red, a link on #09090b a light
    // one), so the fill keeps its 4.5 and the link its 3.
    const accentAsText: [string[], string[], number] = [
      ["primary"],
      SURFACES,
      theme === "light" ? 4.5 : 3,
    ];
    for (const [texts, surfaces, minimum] of [...PAIRS, accentAsText]) {
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

test("the light theme gives every colour token a value of its own", () => {
  const lightOnly = declarations(
    /^:root\[data-theme="light"\]\s*\{([^}]*)\}/gm,
  );
  const missing = [...dark.keys()].filter(
    (name) =>
      /^--(background|card|popover|secondary|muted|accent|overlay|foreground|card-foreground|popover-foreground|secondary-foreground|muted-foreground|accent-foreground|border|input|destructive|success|chart-[134-5]|tier-.+|code-.+)$/.test(
        name,
      ) && !lightOnly.has(name),
  );
  expect(missing).toEqual([]);
});
