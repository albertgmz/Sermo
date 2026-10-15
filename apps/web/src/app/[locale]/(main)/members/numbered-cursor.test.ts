import { expect, test } from "bun:test";
import { numberedCursor, readNumbered } from "./numbered-cursor";

test("a cursor carries the rank of the first row it starts at, and gives it back", () => {
  expect(readNumbered(numberedCursor(21, "abc.def"))).toEqual({
    start: 21,
    cursor: "abc.def",
  });
  expect(readNumbered(numberedCursor(1_000_000, "x\ny"))).toEqual({
    start: 1_000_000,
    cursor: "x\ny",
  });
});

test("no cursor is the first page, numbered from one", () => {
  expect(readNumbered(undefined)).toEqual({ start: 1, cursor: undefined });
  expect(readNumbered(null)).toEqual({ start: 1, cursor: undefined });
  expect(readNumbered("")).toEqual({ start: 1, cursor: undefined });
});

test("a cursor that carries no rank is the backend's own and numbers from one", () => {
  expect(readNumbered("abc")).toEqual({ start: 1, cursor: "abc" });
  expect(readNumbered("abc.21")).toEqual({ start: 1, cursor: "abc.21" });
  expect(readNumbered("12345678.abc")).toEqual({
    start: 1,
    cursor: "12345678.abc",
  });
});
