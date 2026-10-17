import { expect, test } from "bun:test";
import { moved, positionsFor } from "./sort-order";

test("an entry moves one place up or down, and stays at the ends of the list", () => {
  expect(moved(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
  expect(moved(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
  expect(moved(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
  expect(moved(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
  const list = ["a", "b"];
  moved(list, 0, 1);
  expect(list).toEqual(["a", "b"]);
});

test("the numbers the entries held are handed out again, so only the moved ones change", () => {
  // b (20) moved above a (10): they swap numbers, c keeps 35.
  const order = [{ position: 20 }, { position: 10 }, { position: 35 }];
  expect(positionsFor(order)).toEqual([10, 20, 35]);
  expect(positionsFor([])).toEqual([]);
});

test("numbers shared by two entries cannot hold an order, so every entry is numbered anew", () => {
  const order = [{ position: 0 }, { position: 0 }, { position: 4 }];
  expect(positionsFor(order)).toEqual([10, 20, 30]);
});
