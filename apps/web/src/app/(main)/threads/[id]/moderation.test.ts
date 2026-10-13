import { expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
const { forumOptions } = await import("./moderation");

const node = (id: number, type: string) => ({
  id,
  type,
  title: `Node ${id}`,
  depth: 1,
  icon: { fileId: id, url: `/api/v1/files/${id}` },
  cover: { fileId: id + 100, url: `/api/v1/files/${id + 100}` },
});

test("a forum picker is given ids, titles and depths and no picture of a forum", () => {
  const items = [node(1, "category"), node(2, "forum"), node(3, "forum")];
  const options = forumOptions(items as never, 3);
  expect(options).toEqual([{ id: 2, title: "Node 2", depth: 1 }]);
  expect(JSON.stringify(options)).not.toContain("/api/v1/files");
});
