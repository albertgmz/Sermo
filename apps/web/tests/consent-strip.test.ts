import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// The cookie banner is a strip across the bottom of the window (`#cc-main` in globals.css). On a
// forum page on a phone it sits directly on the bottom navigation, with no gap, and the page keeps
// exactly its height free under the content.
const css = readFileSync(
  new URL("../src/app/globals.css", import.meta.url),
  "utf8",
);
const library = readFileSync(
  Bun.resolveSync(
    "vanilla-cookieconsent/dist/cookieconsent.css",
    import.meta.dir,
  ),
  "utf8",
);

test("on a forum phone page the strip sits directly on the bottom navigation, below its top line", () => {
  // The navigation is 3.5rem plus the phone's safe area, and a 1px line on top.
  expect(css).toMatch(
    /@media \(width < 48rem\) \{\s*html:has\(\[data-forum-layout\]\) #cc-main \.cm--bar\.cm--bottom \{\s*bottom: calc\(var\(--spacing-mobile-nav\) \+ 1px\);\s*\}/,
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

test("the strip's phone layout starts where the library's phone sheet starts, in the same unit", () => {
  // The library sets its phone rules for `max-width: 640px`; a query in rem would follow the
  // browser's own font size and leave a band of widths where only one of the two applies.
  const theirs = new Set(
    [...library.matchAll(/@media screen and \(max-width:\s*(\d+px)\)/g)].map(
      (m) => m[1],
    ),
  );
  expect([...theirs]).toEqual(["640px"]);
  const ours = [
    ...css.matchAll(/@media ([^{]+)\{\s*#cc-main \.cm--bar \{/g),
  ].map((m) => m[1]?.trim());
  expect(ours).toEqual(["(width <= 640px)"]);
});

test("the strip shows its parts in the order of the page, so Tab and a screen reader follow it", () => {
  const rules = [...css.matchAll(/#cc-main[^{]*\{([^}]*)\}/g)].map(
    (m) => m[1] ?? "",
  );
  for (const rule of rules) expect(rule).not.toMatch(/(^|[\s;])order:/);
  expect(css).not.toMatch(/grid-area:\s*policy/);
});
