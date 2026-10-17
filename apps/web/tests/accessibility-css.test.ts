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

test("forced colours mark what is pressed, checked or selected with more than a fill, and give toggles an edge", () => {
  const block = mediaBlock("forced-colors: active");
  expect(block).toMatch(
    /\[aria-pressed\] \{\s*border: 1px solid ButtonText;\s*\}/,
  );
  expect(block).toMatch(
    /\[aria-pressed="true"\],\s*\[aria-checked="true"\],\s*\[aria-selected="true"\] \{\s*forced-color-adjust: none;\s*border-color: Highlight;\s*background-color: Highlight;\s*color: HighlightText;\s*\}/,
  );
  // The composer's toggles carry the state the rule reads: the toolbar, the poll kind, the prefix.
  for (const file of [
    "components/forum/editor-toolbar.tsx",
    "components/forum/poll-form.tsx",
    "components/forum/thread-composer.tsx",
  ])
    expect(
      readFileSync(join(import.meta.dir, "../src", file), "utf8"),
    ).toContain("aria-pressed={");
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
