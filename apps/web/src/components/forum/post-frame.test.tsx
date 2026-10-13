import { expect, mock, test } from "bun:test";
import type { ReactElement, ReactNode } from "react";
import type { AuthorView } from "@/lib/sermo/views";

mock.module("server-only", () => ({}));
const { PostFrame } = await import("./post-frame");

const author = {
  member: {
    id: 3,
    username: "ember",
    avatar: null,
    frame: null,
    nameColor: null,
    title: "",
    badges: [],
    level: 1,
  },
  cover: null,
  awards: [],
  xp: 0,
  currentLevelXp: 0,
  nextLevelXp: 100,
  postCount: 4,
  reactionScore: 2,
  signatureHtml: "<p>sig</p>",
} as unknown as AuthorView;

// Every string and element type found in the tree, looking through plain props.children only.
function collect(node: ReactNode, out: { texts: string[]; marks: string[] }) {
  if (node === null || node === undefined || typeof node === "boolean")
    return out;
  if (typeof node === "string" || typeof node === "number") {
    out.texts.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) collect(child, out);
    return out;
  }
  const element = node as ReactElement<{
    children?: ReactNode;
    "data-mark"?: string;
  }>;
  const mark = element.props?.["data-mark"];
  if (mark) out.marks.push(mark);
  collect(element.props?.children, out);
  return out;
}

function frame(props: Partial<Parameters<typeof PostFrame>[0]> = {}) {
  return collect(
    PostFrame({
      id: "post-1",
      author,
      createdAt: "2026-01-02T03:04:05.000Z",
      actions: <i data-mark="actions" />,
      children: <p data-mark="content">hello</p>,
      ...props,
    }),
    { texts: [], marks: [] },
  );
}

test("the frame shows the content and the actions", () => {
  const { texts, marks } = frame();
  expect(marks).toContain("content");
  expect(marks).toContain("actions");
  expect(texts).toContain("hello");
});

test("the article carries the id it is given", () => {
  const tree = PostFrame({
    id: "message-9",
    author,
    createdAt: "2026-01-02T03:04:05.000Z",
    actions: null,
    children: null,
  }) as ReactElement<{ id: string }>;
  expect(tree.type).toBe("article");
  expect(tree.props.id).toBe("message-9");
});

test("the optional slots draw only when given", () => {
  const without = frame();
  expect(without.marks).not.toContain("edited");
  expect(without.marks).not.toContain("trailing");
  expect(without.marks).not.toContain("after");
  const withAll = frame({
    edited: <i data-mark="edited" />,
    trailing: <i data-mark="trailing" />,
    after: <i data-mark="after" />,
  });
  expect(withAll.marks).toContain("edited");
  expect(withAll.marks).toContain("trailing");
  expect(withAll.marks).toContain("after");
});

const base = {
  id: "p",
  author,
  createdAt: "2026-01-02T03:04:05.000Z",
  actions: null,
  children: null,
};

test("the frame draws the author and the time", () => {
  const drawn = JSON.stringify(PostFrame(base));
  expect(drawn).toContain('"username":"ember"');
  expect(drawn).toContain("2026-01-02T03:04:05.000Z");
});

test("the signature closes the frame only when asked for and the author has one", () => {
  const drawn = (props: Parameters<typeof PostFrame>[0]) =>
    JSON.stringify(PostFrame(props));
  expect(drawn(base)).not.toContain("<p>sig</p>");
  expect(drawn({ ...base, signed: true })).toContain("<p>sig</p>");
  expect(
    drawn({ ...base, signed: true, author: { ...author, signatureHtml: "" } }),
  ).not.toContain("<p>sig</p>");
});
