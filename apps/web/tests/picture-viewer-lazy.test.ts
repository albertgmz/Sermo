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

// A touch-action of pan-y alone would block pinch zoom on the picture; the swipe still works
// because a vertical pan stays the browser's and a horizontal move is read by the viewer.
test("the picture area allows pinch zoom", () => {
  const source = readFileSync(
    `${root}src/components/forum/picture-lightbox.tsx`,
    "utf8",
  );
  expect(source).toContain('touchAction: "pan-y pinch-zoom"');
});
