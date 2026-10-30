import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// The cookie banner is a strip across the bottom of the window (`#cc-main` in globals.css). On a
// forum page on a phone it sits directly on the bottom navigation, with no gap, and the page keeps
// exactly its height free under the content.
const css = readFileSync(
  new URL("../src/app/globals.css", import.meta.url),
  "utf8",
);

test("on a forum phone page the strip sits directly on the bottom navigation", () => {
  expect(css).toMatch(
    /@media \(width < 48rem\) \{\s*html:has\(\[data-forum-layout\]\) #cc-main \.cm--bar\.cm--bottom \{\s*bottom: var\(--spacing-mobile-nav\);\s*\}/,
  );
});

test("the strip runs from edge to edge, and the page keeps its height free and no more", () => {
  const strip = css.match(/^#cc-main \.cm--bar \{([^}]*)\}/m)?.[1] ?? "";
  expect(strip).toMatch(/border-top: 1px solid var\(--border\);/);
  expect(strip).not.toMatch(/margin|max-width|border-radius/);
  expect(css).toMatch(
    /html\.show--consent body \{\s*padding-bottom: var\(--consent-space, 0px\);\s*\}/,
  );
});
