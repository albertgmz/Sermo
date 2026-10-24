import { expect, test } from "bun:test";
import { rowsNamedBy, withKept } from "@/components/forum/infinite-list";

// An address that names an element (`#profile-post-1`) lands on it, so the row that holds it stays
// in the window of a long list, however far down it is.

const rows = [
  { key: "9", node: null, holds: ["profile-post-9"] },
  { key: "8", node: null, holds: ["profile-post-8", "profile-comment-81"] },
  { key: "7", node: null },
];

test("the row that holds the element the address names is kept", () => {
  expect(rowsNamedBy(rows, "#profile-post-9")).toEqual([0]);
  expect(rowsNamedBy(rows, "#profile-comment-81")).toEqual([1]);
});

test("no hash, a hash of nothing held, and a malformed hash keep no row", () => {
  expect(rowsNamedBy(rows, "")).toEqual([]);
  expect(rowsNamedBy(rows, "#post-1")).toEqual([]);
  expect(rowsNamedBy(rows, "#%E0%A4%A")).toEqual([]);
});

test("the kept row is added to the window in order", () => {
  expect(withKept([0, 1, 2], rowsNamedBy(rows, "#profile-comment-81"))).toEqual(
    [0, 1, 2],
  );
  expect(withKept([5, 6], [1])).toEqual([1, 5, 6]);
});
