import { expect, test } from "bun:test";
import { itemAtWindowTop, stepIndex } from "./shortcut-items";

test("j and k step to the next and the previous item", () => {
  expect(stepIndex(5, 1, 1)).toBe(2);
  expect(stepIndex(5, 3, -1)).toBe(2);
});

test("the list stops at its first and its last item and does not wrap", () => {
  expect(stepIndex(5, 4, 1)).toBe(4);
  expect(stepIndex(5, 0, -1)).toBe(0);
  expect(stepIndex(1, 0, 1)).toBe(0);
  expect(stepIndex(1, 0, -1)).toBe(0);
});

test("from no item, j goes to the first and k stays on the first", () => {
  expect(stepIndex(5, -1, 1)).toBe(0);
  expect(stepIndex(5, -1, -1)).toBe(0);
});

test("an empty list has nowhere to go", () => {
  expect(stepIndex(0, -1, 1)).toBe(-1);
  expect(stepIndex(0, -1, -1)).toBe(-1);
});

test("the item the reader is at is the last one at or above the top of the window", () => {
  expect(itemAtWindowTop([-900, -400, -10, 250, 800])).toBe(2);
  expect(itemAtWindowTop([0, 300, 700])).toBe(0);
  expect(itemAtWindowTop([1, 300])).toBe(0);
});

test("an item left under the header by the scroll margin of j and k still counts as the top one", () => {
  expect(itemAtWindowTop([-300, 73, 400])).toBe(1);
  expect(itemAtWindowTop([-300, 100, 400])).toBe(0);
});

test("with every item still below the window, the reader is at none", () => {
  expect(itemAtWindowTop([120, 400, 900])).toBe(-1);
  expect(itemAtWindowTop([])).toBe(-1);
});
