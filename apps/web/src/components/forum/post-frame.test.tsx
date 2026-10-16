import { afterAll, expect, mock, test } from "bun:test";
import type { ReactElement, ReactNode } from "react";
import type { AuthorView } from "@/lib/sermo/views";

mock.module("server-only", () => ({}));
// The frame is called as a plain function: it reads the locale without a provider.
const intl = { ...(await import("next-intl")) };
mock.module("next-intl", () => ({ ...intl, useLocale: () => "en" }));
afterAll(() => {
  mock.module("next-intl", () => intl);
});
const { PostFrame } = await import("./post-frame");
const { Postbit } = await import("./postbit");

const author = {
  member: {
    id: 3,
    username: "ember",
    avatar: null,
    frame: null,
    nameColor: null,
    nameIcon: null,
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
  const withAll = frame({
    edited: <i data-mark="edited" />,
    trailing: <i data-mark="trailing" />,
  });
  expect(withAll.marks).toContain("edited");
  expect(withAll.marks).toContain("trailing");
});

const base = {
  id: "p",
  author,
  createdAt: "2026-01-02T03:04:05.000Z",
  actions: null,
  children: null,
};

// The first element of the tree whose type is `type`, wherever it sits.
function find(node: ReactNode, type: unknown): ReactElement | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, type);
      if (found) return found;
    }
    return null;
  }
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (element.type === type) return element;
  return find(element.props?.children, type);
}

test("the frame draws the time and hands the author to the postbit", () => {
  const tree = PostFrame(base);
  expect(JSON.stringify(tree)).toContain("2026-01-02T03:04:05.000Z");
  const bit = find(tree, Postbit) as ReactElement<{ author: AuthorView }>;
  expect(bit).not.toBeNull();
  expect(bit.props.author).toBe(author);
});

test("the signature closes the frame only when asked for and the author has one", () => {
  // The postbit element carries the author as a prop: only what the frame draws itself counts.
  const drawn = (props: Parameters<typeof PostFrame>[0]) =>
    JSON.stringify(PostFrame(props), (key, value) =>
      key === "author" ? undefined : value,
    );
  expect(drawn(base)).not.toContain("<p>sig</p>");
  expect(drawn({ ...base, signed: true })).toContain("<p>sig</p>");
  expect(
    drawn({ ...base, signed: true, author: { ...author, signatureHtml: "" } }),
  ).not.toContain("<p>sig</p>");
});

test("the postbit sits in the frame's grid with the column width set once", () => {
  const tree = PostFrame(base) as ReactElement<{
    className: string;
    style: Record<string, string>;
  }>;
  expect(tree.props.className).toContain("md:grid-cols-[var(--postbit-width)_");
  expect(tree.props.style["--postbit-width"]).toBe("10rem");
  // the cover behind the column ends at the column's border
  expect(tree.props.style["--postbit-cover-width"]).toBe(
    "calc(var(--postbit-width) + 1rem)",
  );
});

test("a highlighted post adds the whole-frame cover; the postbit draws its own behind the column", () => {
  const covered = { ...author, cover: { url: "x" } } as AuthorView;
  const variants = (highlighted: boolean) => {
    const found: string[] = [];
    const walk = (node: ReactNode) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) return node.forEach(walk);
      const el = node as ReactElement<{
        variant?: string;
        children?: ReactNode;
      }>;
      if (el.props?.variant) found.push(el.props.variant);
      walk(el.props?.children);
    };
    walk(PostFrame({ ...base, author: covered, highlighted }));
    return found;
  };
  expect(variants(false)).toEqual([]);
  expect(variants(true)).toEqual(["full"]);
  const cover = (highlighted: boolean) =>
    (
      find(
        PostFrame({ ...base, author: covered, highlighted }),
        Postbit,
      ) as ReactElement<{ coverClassName: string }>
    ).props.coverClassName;
  // on a phone the whole-frame picture alone is drawn; otherwise the postbit's cover is its own
  expect(cover(false)).toBeUndefined();
  expect(cover(true)).toBe("max-md:hidden");
});

test("the postbit's actions reach the postbit, and it has none without them", () => {
  const mark = <i data-mark="member-actions" />;
  const given = find(
    PostFrame({ ...base, postbitActions: mark }),
    Postbit,
  ) as ReactElement<{
    actions?: ReactNode;
  }>;
  expect(given.props.actions).toBe(mark);
  const bare = find(PostFrame(base), Postbit) as ReactElement<{
    actions?: ReactNode;
  }>;
  expect(bare.props.actions).toBeUndefined();
});
