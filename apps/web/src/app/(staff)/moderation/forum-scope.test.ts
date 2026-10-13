import { expect, test } from "bun:test";
import { moderatedForums } from "./forum-scope";

const nodes = [
  { id: 1, parentId: null },
  { id: 2, parentId: 1 },
  { id: 3, parentId: 2 },
  { id: 4, parentId: null },
  { id: 5, parentId: 4 },
];
const staff = {
  moderatesEverywhere: false,
  moderatedNodeIds: [5],
  moderatedNodesTruncated: false,
};
const ids = (list: { id: number }[]) => list.map((node) => node.id);

test("a moderator of one forum is offered that forum only", () => {
  expect(ids(moderatedForums(nodes, staff))).toEqual([5]);
});

test("a forum under a moderated one is offered too", () => {
  expect(
    ids(moderatedForums(nodes, { ...staff, moderatedNodeIds: [1] })),
  ).toEqual([1, 2, 3]);
});

test("someone who moderates everywhere is offered every forum", () => {
  expect(
    ids(moderatedForums(nodes, { ...staff, moderatesEverywhere: true })),
  ).toEqual([1, 2, 3, 4, 5]);
});

test("a cut-short list of moderated forums offers every forum", () => {
  expect(
    ids(moderatedForums(nodes, { ...staff, moderatedNodesTruncated: true })),
  ).toEqual([1, 2, 3, 4, 5]);
});

test("someone who moderates no forum is offered none", () => {
  expect(
    ids(moderatedForums(nodes, { ...staff, moderatedNodeIds: [] })),
  ).toEqual([]);
});
