import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(
  join(import.meta.dir, "../src/app/globals.css"),
  "utf8",
);

// The body of the first `@media (<query>) { ... }` block, braces balanced.
function mediaBlock(query: string): string {
  const start = css.indexOf(`@media (${query}) {`);
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  for (let index = css.indexOf("{", start); index < css.length; index++) {
    if (css[index] === "{") depth++;
    if (css[index] === "}" && --depth === 0) return css.slice(start, index + 1);
  }
  throw new Error(`unclosed @media (${query})`);
}

// Outside every `@layer`, so the rules win over the utility classes (`outline-none`, `ring-*`,
// `animate-in`, `duration-*`) that say otherwise.
function unlayered(block: string) {
  const at = css.indexOf(block);
  const layers = [...css.matchAll(/@layer \w+ \{/g)].map((match) => {
    let depth = 0;
    for (let index = css.indexOf("{", match.index); ; index++) {
      if (css[index] === "{") depth++;
      if (css[index] === "}" && --depth === 0)
        return [match.index, index] as const;
    }
  });
  return layers.every(([from, to]) => at < from || at > to);
}

test("a visitor who asks for less motion gets no animation, transition or smooth scroll", () => {
  const block = mediaBlock("prefers-reduced-motion: reduce");
  expect(unlayered(block)).toBe(true);
  expect(block).toMatch(/\*,\s*\*::before,\s*\*::after\s*\{/);
  for (const rule of [
    "animation-duration: 0.01ms !important",
    "animation-iteration-count: 1 !important",
    "transition-duration: 0.01ms !important",
    "scroll-behavior: auto !important",
  ])
    expect(block).toContain(rule);
});

test("forced colours keep the focus ring and the edges of cards, panels, buttons and badges", () => {
  const block = mediaBlock("forced-colors: active");
  expect(unlayered(block)).toBe(true);
  expect(block).toMatch(
    /:focus-visible \{\s*outline: 2px solid Highlight;\s*outline-offset: 2px;\s*\}/,
  );
  for (const slot of [
    "card",
    "dialog-content",
    "popover-content",
    "dropdown-menu-content",
    "select-content",
    "count-badge",
    "button",
    "badge",
  ])
    expect(block).toContain(`[data-slot="${slot}"]`);
  expect(block).toContain('[aria-current="page"]');
});

// The forced-colours block with its whitespace folded, so a reformat does not matter: one space
// at most, none just inside brackets or after a comma.
function forcedRules() {
  return mediaBlock("forced-colors: active")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\( /g, "(")
    .replace(/ \)/g, ")")
    .replace(/, /g, ",");
}

const source = (file: string) =>
  readFileSync(join(import.meta.dir, "../src", file), "utf8");

// What is pressed, checked or selected; never a switch (its own rule), never a disabled control.
const CHOSEN =
  ':is([aria-pressed="true"],[aria-checked="true"]:not([role="switch"]),[aria-selected="true"]):not(:disabled,[aria-disabled="true"])';

test("forced colours fill what is pressed, checked or selected with the highlight, but not a switch or a disabled control", () => {
  const rules = forcedRules();
  expect(rules).toContain(
    `${CHOSEN} { forced-color-adjust: none; border-color: Highlight; background-color: Highlight; color: HighlightText; }`,
  );
  // `forced-color-adjust` inherits: what is inside is drawn in the highlight's text colour too.
  expect(rules).toContain(
    `${CHOSEN} * { border-color: HighlightText; background-color: transparent; color: HighlightText; }`,
  );
  // No other rule fills a checked control or sets the adjust: only the chosen ones and the switch.
  expect(rules.match(/forced-color-adjust: none/g)).toHaveLength(3);
  // No rule draws a border on every toggle: that undid deliberate `border-0` / `border-l-0`.
  expect(rules).not.toMatch(/\[aria-pressed\] \{/);
  // The composer's toggles carry the state the rule reads: the toolbar, the poll kind, the prefix.
  for (const file of [
    "components/forum/editor-toolbar.tsx",
    "components/forum/poll-form.tsx",
    "components/forum/thread-composer.tsx",
  ])
    expect(source(file)).toContain("aria-pressed={");
});

test("chips whose edge is a ring draw a border in forced colours", () => {
  for (const file of [
    "components/forum/poll-form.tsx",
    "components/forum/thread-composer.tsx",
  ])
    expect(source(file)).toMatch(
      /aria-pressed=\{[\s\S]*?"inline-flex min-h-10 items-center rounded-full[^"]*forced-colors:border[^"]*"/,
    );
});

test("forced colours draw the staff switch on and off apart in system colours", () => {
  const rules = forcedRules();
  for (const rule of [
    '[role="switch"]:not([aria-checked="true"]) > span { forced-color-adjust: none; border-color: ButtonText; background-color: Canvas; }',
    '[role="switch"][aria-checked="true"] > span { forced-color-adjust: none; border-color: Highlight; background-color: Highlight; }',
    '[role="switch"]:disabled > span { border-color: GrayText; background-color: Canvas; }',
    '[role="switch"]:not([aria-checked="true"]) > span > span { background-color: ButtonText; }',
    '[role="switch"][aria-checked="true"] > span > span { background-color: HighlightText; }',
    '[role="switch"]:disabled > span > span { background-color: GrayText; }',
  ])
    expect(rules).toContain(rule);
  // Disabled comes after on and off at the same specificity, so it wins while the switch saves.
  expect(rules.indexOf('[role="switch"]:disabled > span {')).toBeGreaterThan(
    rules.indexOf('[role="switch"][aria-checked="true"] > span {'),
  );
  // The shape the rule reads: the switch is a button holding a track that holds the thumb.
  expect(source("components/staff/item-list.tsx")).toMatch(
    /role="switch"[\s\S]*?className="[^"]*"\s*>\s*<span className="[^"]*">\s*<span className="[^"]*" \/>\s*<\/span>\s*<\/button>/,
  );
});

test("Tab never leaves the focus under the top bars, the phone bar or the cookie banner", () => {
  expect(css).toMatch(
    /html:has\(\[data-forum-layout\], \[data-frame\]\) \{\s*scroll-padding-top: var\(--spacing-site-header\);/,
  );
  expect(css).toMatch(
    /@media \(width < 48rem\) \{\s*html:has\(\[data-forum-layout\]\) \{\s*scroll-padding-bottom: var\(--spacing-mobile-nav\);/,
  );
  expect(css).toMatch(
    /html\.show--consent \{\s*scroll-padding-bottom: calc\(var\(--consent-space, 0px\) \+ 2rem\);/,
  );
  expect(css).toMatch(
    /html\.show--consent:has\(\[data-forum-layout\]\) \{\s*scroll-padding-bottom: calc\(\s*var\(--spacing-mobile-nav\)\s*\+\s*var\(--consent-space, 0px\)\s*\+\s*2rem\s*\);/,
  );
  // The two frames apart from the forum carry the mark the top padding reads.
  for (const [group, name] of [
    ["(staff)", "staff"],
    ["(developer)", "developer"],
  ]) {
    const layout = readFileSync(
      join(import.meta.dir, `../src/app/[locale]/${group}/layout.tsx`),
      "utf8",
    );
    expect(layout).toContain(`data-frame="${name}"`);
  }
});
