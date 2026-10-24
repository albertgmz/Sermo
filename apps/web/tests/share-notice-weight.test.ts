import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const root = import.meta.dir.replace(/tests$/, "");
const source = (path: string) => readFileSync(`${root}${path}`, "utf8");
const imports = (path: string) =>
  [...source(path).matchAll(/^import[^;]*?from\s+"([^"]+)";/gm)].map(
    ([, from]) => from,
  );

// The notice a Share button says ("Link copied") is mounted by the main layout, so it is on every
// page, most of which have no Share button: what it imports is in every page's first load. It
// takes the notice's key from the store, not from the share code (`share-link`), which brings the
// clipboard and the referral address with it, and draws it with the notice's view alone, not with
// a page's whole notice (`PageNotice`).
test("the layout's link-copied notice does not bring the share code to every page", () => {
  const notice = imports("src/components/forum/share-notice.tsx");
  expect(notice).not.toContain("@/components/forum/share-link");
  expect(notice).not.toContain("@/components/forum/share-button");
  expect(notice).not.toContain("@/components/forum/page-notice");
  expect(notice).toContain("@/components/forum/notice-store");
  expect(notice).toContain("@/components/forum/notice-view");
});
