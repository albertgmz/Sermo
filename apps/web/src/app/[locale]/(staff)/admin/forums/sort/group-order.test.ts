import { expect, test } from "bun:test";
import { groupPositions, moveInGroup, type OrderGroup } from "./group-order";

const entry = (id: number, position: number) => ({ id, position });

// Group "top" holds distinct numbers; group "7" shares a number between two entries.
const start: OrderGroup[] = [
  { id: "top", items: [entry(1, 10), entry(2, 20), entry(3, 30)] },
  { id: "7", items: [entry(4, 5), entry(5, 5), entry(6, 8)] },
];

test("a move in one group changes no position in another", () => {
  const after = moveInGroup(start, "top", 0, 1);
  const positions = groupPositions(after, start);
  // The group that was moved: the two swapped entries trade numbers, the third keeps its own.
  expect([1, 2, 3].map((id) => positions.get(id))).toEqual([20, 10, 30]);
  // The other group, which has a shared number, keeps every number it came with.
  expect([4, 5, 6].map((id) => positions.get(id))).toEqual([5, 5, 8]);
  expect(after[1]).toBe(start[1]);
});

test("a group moved and put back sends the numbers it came with", () => {
  const there = moveInGroup(start, "7", 0, 1);
  const back = moveInGroup(there, "7", 1, -1);
  const positions = groupPositions(back, start);
  expect([4, 5, 6].map((id) => positions.get(id))).toEqual([5, 5, 8]);
});

test("a moved group whose numbers are shared is numbered anew, ten apart, and the others stay", () => {
  const after = moveInGroup(start, "7", 1, 1);
  const positions = groupPositions(after, start);
  expect([4, 6, 5].map((id) => positions.get(id))).toEqual([10, 20, 30]);
  expect([1, 2, 3].map((id) => positions.get(id))).toEqual([10, 20, 30]);
});

test("an entry cannot leave its group or the ends of it", () => {
  expect(moveInGroup(start, "top", 0, -1)[0].items.map((e) => e.id)).toEqual([
    1, 2, 3,
  ]);
  expect(moveInGroup(start, "top", 2, 1)[0].items.map((e) => e.id)).toEqual([
    1, 2, 3,
  ]);
  expect(moveInGroup(start, "top", 1, 1)[1]).toBe(start[1]);
});
