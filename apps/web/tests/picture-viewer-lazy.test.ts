import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { walk } from "./lite-scan";

const root = import.meta.dir.replace(/tests$/, "");

// The viewer's code (the dialog, the reactions and the composer around it) must come when a picture
// is opened, not with the list: only `picture-viewer.tsx` names it, and through `dynamic(`.
test("the picture lightbox is loaded lazily and by nothing else", () => {
  const holders = walk("src")
    .filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path))
    .filter((path) =>
      /from\s+["'][^"']*picture-lightbox["']|import\(\s*["'][^"']*picture-lightbox["']/.test(
        readFileSync(`${root}${path}`, "utf8"),
      ),
    );
  expect(holders).toEqual(["src/components/forum/picture-viewer.tsx"]);
  const viewer = readFileSync(`${root}${holders[0]}`, "utf8");
  expect(viewer).toMatch(/dynamic\(\s*\(\)\s*=>\s*import\(/);
  expect(viewer).not.toMatch(/^import[^;]*picture-lightbox/m);
});
