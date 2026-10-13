import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Pages that are nobody's to find through a search engine say so: each layout or page below
// takes the `NOINDEX` robots value, which covers the routes under it.
const COVERED = [
  // Sign-in, registration, password reset and verification.
  "src/app/(auth)/layout.tsx",
  // Everything under /account, the viewing-mode settings of a member among it.
  "src/app/(main)/account/layout.tsx",
  "src/app/(main)/conversations/layout.tsx",
  "src/app/(main)/notifications/page.tsx",
  "src/app/(main)/lite/page.tsx",
  "src/app/(main)/ui/page.tsx",
];

test("the routes that are no one's to find take the noindex robots value", () => {
  for (const file of COVERED) {
    const source = readFileSync(join(import.meta.dir, "..", file), "utf8");
    expect(source, file).toContain("robots: NOINDEX");
  }
});

test("every route that takes the sign-in layout is one of the sign-in pages", () => {
  const layout = readFileSync(
    join(import.meta.dir, "..", "src/app/(auth)/layout.tsx"),
    "utf8",
  );
  expect(layout).toContain("export const metadata");
});
