import { expect, test } from "bun:test";
import { parseThreadRef } from "./thread-ref";

test("a thread is named by its number or its address", () => {
  expect(parseThreadRef("12")).toBe(12);
  expect(parseThreadRef(" 12 ")).toBe(12);
  expect(parseThreadRef("/threads/12")).toBe(12);
  expect(parseThreadRef("http://localhost:3111/threads/12")).toBe(12);
  expect(
    parseThreadRef("https://forum.example/threads/12-a-title?page=2#x"),
  ).toBe(12);
});

test("anything else names no thread", () => {
  for (const text of [
    "",
    "0",
    "-3",
    "0x10",
    "1e2",
    "abc",
    "/forums/12",
    "http://x.y/threads/",
    "http://x.y/threads/a",
    "/threads/12/edit",
  ]) {
    expect(parseThreadRef(text)).toBeNull();
  }
});
