import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { foldPanel } from "./collapsible-panel";

function body() {
  const attributes = new Map<string, string>();
  return {
    attributes,
    setAttribute: (name: string, value: string) => {
      attributes.set(name, value);
    },
    removeAttribute: (name: string) => {
      attributes.delete(name);
    },
  };
}

test("a closed panel's body is hidden until the browser's find reaches it, an open one is shown", () => {
  const panel = body();
  foldPanel(panel, true);
  expect(panel.attributes.get("hidden")).toBe("until-found");
  foldPanel(panel, false);
  expect(panel.attributes.has("hidden")).toBe(false);
});

// Without a DOM here, the wiring is read from the source: the attribute follows the closed state
// before paint, a match found by the browser opens the panel, and no class hides the body with
// display:none once the state is known.
test("the panel folds its body through foldPanel and opens on beforematch", () => {
  const source = readFileSync(
    join(import.meta.dir, "collapsible-panel.tsx"),
    "utf8",
  );
  expect(source).toMatch(
    /useLayoutEffect\(\(\) => \{\s*if \(body\.current\) foldPanel\(body\.current, closed\);\s*\}, \[closed\]\);/,
  );
  expect(source).toMatch(
    /const found = \(\) => writeOpen\(storageKey, true\);\s*panel\.addEventListener\("beforematch", found\);\s*return \(\) => panel\.removeEventListener\("beforematch", found\);/,
  );
  expect(source).toContain("ref={body}");
  expect(source).toContain('responsive && "hidden md:block"');
  expect(source).not.toContain('!shown && "hidden"');
});
