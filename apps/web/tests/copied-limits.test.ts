import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The backend refuses a text that is too long and says so; a form carries no limit of its own to
// keep in step with it.
const FORMS = [
  "src/app/[locale]/(main)/threads/[id]/page.tsx",
  "src/app/[locale]/(main)/threads/[id]/moderation.tsx",
  "src/app/[locale]/(main)/threads/[id]/edit/[postId]/edit-post-form.tsx",
  "src/components/forum/delete-control.tsx",
];

test("the forms carry no text length of their own", () => {
  for (const file of FORMS) {
    const source = readFileSync(join(import.meta.dir, "..", file), "utf8");
    expect(source, file).not.toContain("maxLength");
  }
});

test("a page size is not written out where a page is counted", () => {
  for (const file of [
    "src/app/[locale]/(main)/threads/[id]/pages.ts",
    "src/app/[locale]/(main)/conversations/[id]/page.tsx",
  ]) {
    const source = readFileSync(join(import.meta.dir, "..", file), "utf8");
    expect(source, file).not.toMatch(/PER_PAGE\s*=\s*\d/);
  }
});
