import { expect, test } from "bun:test";
import { memberIdOf } from "./authors";
import {
  type ApiNode,
  cardMembers,
  childrenByParent,
  forumCard,
} from "./forums";

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
  const card = forumCard(
    top,
    childrenByParent(nodes),
    () => {
      throw new Error("no last post to draw");
    },
    false,
    false,
  );
  expect(card.threadCount).toBe(9);
  expect(card.postCount).toBe(60);
  expect(card.subforums).toEqual([{ id: 2, title: "Forum 2" }]);
});

test("the members a sub-forum card needs include the author of a last post in a forum under it", () => {
  const withPost = (
    id: number,
    parentId: number | null,
    userId: number,
    at: string,
  ) =>
    ({
      ...node(id, parentId, 0, 0),
      lastPost: {
        postedAt: at,
        user: { kind: "member", id: userId, username: `u${userId}` },
      },
    }) as unknown as ApiNode;
  // The child's own newest post is old (member 1); the grandchild's is newer (member 2).
  const child = withPost(2, 1, 1, "2026-01-01T00:00:00.000Z");
  const nodes = [
    node(1, null, 0, 0),
    child,
    withPost(3, 2, 2, "2026-02-01T00:00:00.000Z"),
  ];
  const childrenOf = childrenByParent(nodes);
  const known = new Set(cardMembers([child], childrenOf).map(memberIdOf));
  const card = forumCard(
    child,
    childrenOf,
    (ref) => {
      const id = typeof ref === "number" ? ref : memberIdOf(ref);
      if (!known.has(id)) throw new Error(`The member ${id} was not collected`);
      return {} as never;
    },
    false,
    false,
  );
  expect(card.lastPost?.author.username).toBe("u2");
  expect([...known]).toEqual([2]);
});
