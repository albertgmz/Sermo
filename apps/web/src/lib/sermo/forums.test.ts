import { expect, test } from "bun:test";
import { type ApiNode, childrenByParent, forumCard } from "./forums";

const node = (
  id: number,
  parentId: number | null,
  threadCount: number,
  postCount: number,
) =>
  ({
    id,
    parentId,
    title: `Forum ${id}`,
    iconKey: null,
    cover: null,
    icon: null,
    threadCount,
    postCount,
    lastPost: null,
  }) as unknown as ApiNode;

test("a forum card counts the forums under it, and its sub-forum links are the direct children", () => {
  const top = node(1, null, 2, 10);
  const nodes = [top, node(2, 1, 3, 20), node(3, 2, 4, 30)];
  const card = forumCard(top, childrenByParent(nodes), () => {
    throw new Error("no last post to draw");
  });
  expect(card.threadCount).toBe(9);
  expect(card.postCount).toBe(60);
  expect(card.subforums).toEqual([{ id: 2, title: "Forum 2" }]);
});
