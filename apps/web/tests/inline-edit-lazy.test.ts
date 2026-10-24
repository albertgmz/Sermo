import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { walk } from "./lite-scan";

const root = import.meta.dir.replace(/tests$/, "");

// The inline edit form (the editor around an item's source) is only drawn after Edit is pressed,
// so a feed or a wall does not carry its code: only `lazy-inline-edit-form.tsx` names it, and
// through `dynamic(`.
test("the inline edit form is loaded lazily and by nothing else", () => {
  const holders = walk("src")
    .filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path))
    .filter((path) =>
      /from\s+["'][^"']*\/inline-edit-form["']|import\(\s*["'][^"']*\/inline-edit-form["']/.test(
        readFileSync(`${root}${path}`, "utf8"),
      ),
    );
  expect(holders).toEqual(["src/components/forum/lazy-inline-edit-form.tsx"]);
  const lazy = readFileSync(`${root}${holders[0]}`, "utf8");
  expect(lazy).toMatch(/dynamic\(\s*\(\)\s*=>\s*import\(/);
  expect(lazy).not.toMatch(/^import[^;]*inline-edit-form/m);
});
