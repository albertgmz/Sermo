import { expect, test } from "bun:test";
import { opensCard, opensCardKey } from "./member-card-intent";

const plain = {
  button: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
};

test("a plain primary click opens the card", () => {
  expect(opensCard(plain)).toBe(true);
});

test("a modified, middle or secondary click keeps the browser's default", () => {
  expect(opensCard({ ...plain, ctrlKey: true })).toBe(false);
  expect(opensCard({ ...plain, metaKey: true })).toBe(false);
  expect(opensCard({ ...plain, shiftKey: true })).toBe(false);
  expect(opensCard({ ...plain, altKey: true })).toBe(false);
  expect(opensCard({ ...plain, button: 1 })).toBe(false);
  expect(opensCard({ ...plain, button: 2 })).toBe(false);
});

test("Space opens the card, other keys do not", () => {
  expect(opensCardKey(" ")).toBe(true);
  expect(opensCardKey("Enter")).toBe(false);
  expect(opensCardKey("a")).toBe(false);
});
