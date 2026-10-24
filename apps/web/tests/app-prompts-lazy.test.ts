import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { walk } from "./lite-scan";

const root = import.meta.dir.replace(/tests$/, "");

// The cards that offer the app and notifications draw nothing until the cookie banner is settled and
// the visit has a few pages, so their code (and the push code with it) comes once the page is
// interactive, not with the first load of every page: only `app-prompts-lazy.tsx` names it, and
// through `dynamic(`.
test("the app and notification cards are loaded lazily and by nothing else", () => {
  const holders = walk("src")
    .filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path))
    .filter((path) =>
      /from\s+["'][^"']*\/layout\/app-prompts["']|import\(\s*["'][^"']*\/layout\/app-prompts["']/.test(
        readFileSync(`${root}${path}`, "utf8"),
      ),
    );
  expect(holders).toEqual(["src/components/layout/app-prompts-lazy.tsx"]);
  const lazy = readFileSync(`${root}${holders[0]}`, "utf8");
  expect(lazy).toMatch(/dynamic\(\s*\(\)\s*=>\s*import\(/);
  expect(lazy).toContain("ssr: false");
  expect(lazy).not.toMatch(/^import[^;]*layout\/app-prompts"/m);
});
