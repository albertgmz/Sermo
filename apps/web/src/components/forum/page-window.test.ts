import { expect, test } from "bun:test";
import {
  jumpPage,
  lastPages,
  pageAddress,
  pageOfSearch,
  pagerEntries,
  pageWindow,
} from "./page-window";

// The window written the way it reads: page numbers, and "…" for a skip.
const bar = (current: number, total: number, range = 2) =>
  pageWindow(current, total, range)
    .map((entry) => (entry.kind === "page" ? String(entry.page) : "…"))
    .join(" ");

// The bar one screen shows.
const shown = (current: number, total: number, screen: "wide" | "narrow") =>
  pagerEntries(current, total)
    .filter((entry) => entry[screen])
    .map((entry) => (entry.kind === "page" ? String(entry.page) : "…"))
    .join(" ");

test("a list of one page has no pager", () => {
  expect(pageWindow(1, 1, 2)).toEqual([]);
  expect(pageWindow(1, 0, 2)).toEqual([]);
  expect(pagerEntries(1, 1)).toEqual([]);
});

test("a list of two pages shows both", () => {
  expect(bar(1, 2)).toBe("1 2");
  expect(bar(2, 2)).toBe("1 2");
});

test("near the start: the first pages, a skip, the last page", () => {
  expect(bar(1, 68)).toBe("1 2 3 … 68");
  expect(bar(2, 68)).toBe("1 2 3 4 … 68");
  expect(bar(3, 68)).toBe("1 2 3 4 5 … 68");
});

test("a gap of one page shows that page instead of a skip", () => {
  expect(bar(5, 68)).toBe("1 2 3 4 5 6 7 … 68");
  expect(bar(64, 68)).toBe("1 … 62 63 64 65 66 67 68");
});

test("in the middle: the first page, a skip, two pages either side, a skip, the last page", () => {
  expect(bar(34, 68)).toBe("1 … 32 33 34 35 36 … 68");
});

test("near the end: the first page, a skip, the last pages", () => {
  expect(bar(68, 68)).toBe("1 … 66 67 68");
  expect(bar(67, 68)).toBe("1 … 65 66 67 68");
});

test("a short list shows every page", () => {
  expect(bar(3, 5)).toBe("1 2 3 4 5");
  expect(bar(1, 4)).toBe("1 2 3 4");
});

test("a page past the end or before the start is drawn as the nearest page", () => {
  expect(bar(90, 68)).toBe(bar(68, 68));
  expect(bar(0, 68)).toBe(bar(1, 68));
});

test("a skip opens 'go to page' at the page next to the window", () => {
  const entries = pageWindow(34, 68, 2);
  expect(entries[1]).toEqual({ kind: "skip", jump: 31 });
  expect(entries.at(-2)).toEqual({ kind: "skip", jump: 37 });
});

test("a phone shows one page either side, a wide screen two, in one bar", () => {
  expect(shown(34, 68, "wide")).toBe("1 … 32 33 34 35 36 … 68");
  expect(shown(34, 68, "narrow")).toBe("1 … 33 34 35 … 68");
  // Where the phone skips pages the wide screen shows, the skip sits before them.
  expect(shown(5, 68, "wide")).toBe("1 2 3 4 5 6 7 … 68");
  expect(shown(5, 68, "narrow")).toBe("1 … 4 5 6 … 68");
  expect(
    pagerEntries(5, 68).map((entry) =>
      entry.kind === "page" ? entry.page : "…",
    ),
  ).toEqual([1, "…", 2, 3, 4, 5, 6, "…", 7, "…", 68]);
  expect(shown(1, 2, "narrow")).toBe("1 2");
});

test("thread rows link to the last three pages, never the first", () => {
  expect(lastPages(1)).toEqual([]);
  expect(lastPages(2)).toEqual([2]);
  expect(lastPages(3)).toEqual([2, 3]);
  expect(lastPages(4)).toEqual([2, 3, 4]);
  expect(lastPages(68)).toEqual([66, 67, 68]);
});

test("go to page takes a number within the pages", () => {
  expect(jumpPage("12", 68)).toBe(12);
  expect(jumpPage(" 7 ", 68)).toBe(7);
});

test("go to page brings a number out of range to the nearest page", () => {
  expect(jumpPage("500", 68)).toBe(68);
  expect(jumpPage("0", 68)).toBe(1);
});

test("go to page does nothing with what is not a number", () => {
  expect(jumpPage("", 68)).toBeNull();
  expect(jumpPage("abc", 68)).toBeNull();
  expect(jumpPage("-3", 68)).toBeNull();
  expect(jumpPage("2.5", 68)).toBeNull();
});

test("a page's address keeps the list's other parameters and names no first page", () => {
  expect(pageAddress("/threads/7", {}, 1)).toBe("/threads/7");
  expect(pageAddress("/threads/7", {}, 3)).toBe("/threads/7?page=3");
  expect(pageAddress("/threads/7", { select: "1", page: "9" }, 4)).toBe(
    "/threads/7?select=1&page=4",
  );
  expect(pageAddress("/search", { q: "a b", t: ["x", "y"] }, 1)).toBe(
    "/search?q=a+b&t=x&t=y",
  );
});

test("the page an address names", () => {
  expect(pageOfSearch("")).toBe(1);
  expect(pageOfSearch("?page=4")).toBe(4);
  expect(pageOfSearch("?page=abc")).toBe(1);
  expect(pageOfSearch("?select=1&page=2")).toBe(2);
});
