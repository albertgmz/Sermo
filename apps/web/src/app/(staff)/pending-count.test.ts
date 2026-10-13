import { expect, test } from "bun:test";
import { pendingCount, pendingTotal } from "./pending-count";

test("a queue with nothing for the viewer carries no mark, whatever `more` says", () => {
  expect(pendingCount({ count: 0, more: true })).toEqual({
    count: 0,
    more: false,
  });
});

test("a queue with a count keeps the mark of a cut-off scan", () => {
  expect(pendingCount({ count: 3, more: true })).toEqual({
    count: 3,
    more: true,
  });
  expect(pendingCount({ count: 3, more: false })).toEqual({
    count: 3,
    more: false,
  });
});

test("the total is null when the viewer has nothing, with a mark when a queue with a count was cut off", () => {
  expect(
    pendingTotal({ count: 0, more: true }, { count: 0, more: true }),
  ).toBeNull();
  expect(
    pendingTotal({ count: 0, more: true }, { count: 3, more: false }),
  ).toEqual({ count: 3, more: false });
  expect(
    pendingTotal({ count: 3, more: true }, { count: 0, more: false }),
  ).toEqual({ count: 3, more: true });
});
