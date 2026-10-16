import { expect, test } from "bun:test";
import {
  type CreateData,
  createOptions,
  isThreadKind,
  postableForums,
} from "./create-kinds";
import type { ForumChoice } from "./forum-choices";

const forum = (
  id: number,
  parentId: number | null,
  type: ForumChoice["type"],
  canPost: boolean,
): ForumChoice => ({ id, parentId, title: `Node ${id}`, type, canPost });

const data = (over: Partial<CreateData>): CreateData => ({
  memberId: 5,
  forums: [forum(1, null, "category", false), forum(2, 1, "forum", true)],
  prefixes: [],
  canTag: false,
  canWall: true,
  ...over,
});

test("a member who may post in a forum and on their wall is offered every kind, wall post last", () => {
  expect(createOptions(data({}))).toEqual([
    "discussion",
    "question",
    "poll",
    "wall",
  ]);
});

test("a member who may post in no forum is offered the wall post alone", () => {
  const none = data({
    forums: [forum(1, null, "category", false), forum(2, 1, "forum", false)],
  });
  expect(createOptions(none)).toEqual(["wall"]);
  expect(createOptions(data({ forums: [] }))).toEqual(["wall"]);
});

test("a member who may not post on their wall is offered the threads alone, and nothing with neither", () => {
  expect(createOptions(data({ canWall: false }))).toEqual([
    "discussion",
    "question",
    "poll",
  ]);
  expect(createOptions(data({ canWall: false, forums: [] }))).toEqual([]);
});

test("staff, who may post everywhere, are offered what a member is", () => {
  const staff = data({
    forums: [
      forum(1, null, "category", true),
      forum(2, 1, "forum", true),
      forum(3, 1, "forum", true),
    ],
  });
  expect(createOptions(staff)).toEqual(createOptions(data({})));
});

test("a category takes no thread, whatever it says about posting", () => {
  const forums = [
    forum(1, null, "category", true),
    forum(2, 1, "forum", true),
    forum(3, 1, "forum", false),
  ];
  expect(postableForums(forums).map((item) => item.id)).toEqual([2]);
  expect(
    createOptions(data({ forums: [forum(1, null, "category", true)] })),
  ).toEqual(["wall"]);
});

test("three kinds are threads and the wall post is not", () => {
  expect(isThreadKind("discussion")).toBe(true);
  expect(isThreadKind("question")).toBe(true);
  expect(isThreadKind("poll")).toBe(true);
  expect(isThreadKind("wall")).toBe(false);
});
