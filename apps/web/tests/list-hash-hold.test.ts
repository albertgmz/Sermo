import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { rowsNamedBy, withKept } from "@/components/forum/infinite-list";

// An address that names an element (`#profile-post-1`) lands on it: the list finds the row that
// holds it and, while the address names one, keeps all its rows in the page as plain flow (no
// window of guessed heights) so the landing and the reader's scroll are not moved by rows being
// measured.

const rows = [
  { key: "9", node: null, holds: ["profile-post-9"] },
  { key: "8", node: null, holds: ["profile-post-8", "profile-comment-81"] },
  { key: "7", node: null },
];

test("the row that holds the element the address names is found", () => {
  expect(rowsNamedBy(rows, "#profile-post-9")).toEqual([0]);
  expect(rowsNamedBy(rows, "#profile-comment-81")).toEqual([1]);
});

test("no hash, a hash of nothing held, and a malformed hash keep no row", () => {
  expect(rowsNamedBy(rows, "")).toEqual([]);
  expect(rowsNamedBy(rows, "#post-1")).toEqual([]);
  expect(rowsNamedBy(rows, "#%E0%A4%A")).toEqual([]);
});

test("a kept row is added to the window in order", () => {
  expect(withKept([0, 1, 2], rowsNamedBy(rows, "#profile-comment-81"))).toEqual(
    [0, 1, 2],
  );
  expect(withKept([5, 6], [1])).toEqual([1, 5, 6]);
});

test("the list is windowed only while its address names no row it holds", () => {
  const code = readFileSync(
    `${import.meta.dir}/../src/components/forum/infinite-list.tsx`,
    "utf8",
  );
  expect(code).toMatch(/rowsNamedBy\(rows, location\.hash\)\.length > 0/);
  expect(code).toContain("const windowed = live && !landing;");
  // A windowed list positions and measures its rows; a landing one leaves them in flow.
  expect(code).toContain(
    "ref={windowed ? virtualizer.measureElement : undefined}",
  );
});
