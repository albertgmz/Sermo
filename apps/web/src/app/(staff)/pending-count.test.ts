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

test("the cap of the answer is not a display limit: only the count and the mark are kept", () => {
  const answer = { count: 7, more: true, cap: 7 };
  expect(pendingCount(answer)).toEqual({ count: 7, more: true });
  expect(pendingTotal(answer, { count: 2, more: false, cap: 50 })).toEqual({
    count: 9,
    more: true,
  });
});
