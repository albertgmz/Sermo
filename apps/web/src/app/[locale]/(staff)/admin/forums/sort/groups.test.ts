import { expect, test } from "bun:test";
import { sortableGroups } from "./groups";

const node = (id: number, parentId: number | null) => ({ id, parentId });

test("the nodes are grouped by parent in the tree's order, and a lone child is left out", () => {
  const groups = sortableGroups([
    node(1, null),
    node(2, 1),
    node(3, 1),
    node(4, null),
    node(5, 4),
    node(6, 3),
    node(7, 3),
  ]);
  expect(groups.map((g) => [g.parentId, g.members.map((n) => n.id)])).toEqual([
    [null, [1, 4]],
    [1, [2, 3]],
    [3, [6, 7]],
  ]);
});

test("nothing is offered when no two nodes share a parent", () => {
  expect(sortableGroups([node(1, null)])).toEqual([]);
  expect(sortableGroups([node(1, null), node(2, 1)])).toEqual([]);
  expect(sortableGroups([])).toEqual([]);
});
