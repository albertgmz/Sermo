import { expect, test } from "bun:test";
import type { ReactionType } from "@/components/forum/reaction-button";
import { withViewerReaction } from "@/lib/reaction-state";

const type = (id: number): ReactionType => ({
  id,
  key: String(id),
  label: `Type ${id}`,
  emoji: "x",
  picture: null,
});
const LIKE = type(1);
const LOVE = type(2);
const LAUGH = type(3);
const offered = [LIKE, LOVE];

const some = {
  total: 4,
  byType: [
    { type: LIKE, count: 3 },
    { type: LOVE, count: 1 },
  ],
};

test("no change leaves the summary as it is", () => {
  expect(withViewerReaction(some, null, null, offered)).toBe(some);
});

test("a first reaction adds one to its type and to the total", () => {
  const after = withViewerReaction(some, null, 2, offered);
  expect(after.total).toBe(5);
  expect(after.byType.map(({ type: t, count }) => [t.id, count])).toEqual([
    [1, 3],
    [2, 2],
  ]);
});

test("a reaction on an item nobody reacted to makes its summary", () => {
  const after = withViewerReaction({ total: 0, byType: [] }, null, 1, offered);
  expect(after.total).toBe(1);
  expect(after.byType).toEqual([{ type: LIKE, count: 1 }]);
});

test("taking the reaction back removes its type when it was the only one", () => {
  const after = withViewerReaction(
    { total: 1, byType: [{ type: LIKE, count: 1 }] },
    1,
    null,
    offered,
  );
  expect(after).toEqual({ total: 0, byType: [] });
});

test("changing the reaction moves one from the old type to the new and keeps the order by count", () => {
  const after = withViewerReaction(some, 1, 2, offered);
  expect(after.total).toBe(4);
  expect(after.byType.map(({ type: t, count }) => [t.id, count])).toEqual([
    [1, 2],
    [2, 2],
  ]);
  const again = withViewerReaction(
    {
      total: 4,
      byType: [
        { type: LIKE, count: 2 },
        { type: LOVE, count: 2 },
      ],
    },
    1,
    2,
    offered,
  );
  expect(again.byType.map(({ type: t }) => t.id)).toEqual([2, 1]);
});

test("a reaction of a type that is no longer offered is still counted down", () => {
  const after = withViewerReaction(
    { total: 2, byType: [{ type: LAUGH, count: 2 }] },
    3,
    1,
    offered,
  );
  expect(after.total).toBe(2);
  expect(after.byType.map(({ type: t, count }) => [t.id, count])).toEqual([
    [3, 1],
    [1, 1],
  ]);
});
