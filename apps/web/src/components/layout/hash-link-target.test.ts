import { expect, test } from "bun:test";
import { hashLinkTarget } from "./hash-link-target";

const here = (path: string, search = "") => ({
  href: `https://x.test${path}${search}#post-45`,
  pathname: path,
  search,
});
const on =
  (...ids: string[]) =>
  (id: string) =>
    ids.includes(id);

test("a bare hash stays on the page with the path and query as they are", () => {
  const to = hashLinkTarget({
    href: "#reply",
    here: here("/threads/7-slug", "?page=2&select=1"),
    hasElement: on(),
  });
  expect(to).toEqual({
    samePage: true,
    url: "/threads/7-slug?page=2&select=1#reply",
    hash: "#reply",
  });
});

test("a post on the page being read keeps the query, a cursor or a selection included", () => {
  for (const search of ["?page=2", "?cursor=abc&select=1", ""]) {
    const to = hashLinkTarget({
      href: "/threads/7?page=2#post-43",
      here: here("/threads/7-slug", search),
      hasElement: on("post-43"),
    });
    expect(to.samePage).toBe(true);
    expect(to.url).toBe(`/threads/7-slug${search}#post-43`);
  }
});

test("a post of another page goes to its own address, with no query on the first page", () => {
  const other = hashLinkTarget({
    href: "/threads/7?page=3#post-90",
    here: here("/threads/7-slug", "?page=2"),
    hasElement: on("post-43"),
  });
  expect(other).toEqual({
    samePage: false,
    url: "/threads/7?page=3#post-90",
    hash: "#post-90",
  });
  const first = hashLinkTarget({
    href: "/threads/7#post-5",
    here: here("/threads/7-slug", "?page=2"),
    hasElement: on(),
  });
  expect(first.url).toBe("/threads/7#post-5");
  expect(first.url).not.toContain("?");
});

test("a first page with no query on the page keeps the address clean", () => {
  const to = hashLinkTarget({
    href: "/threads/7#post-5",
    here: here("/threads/7-slug"),
    hasElement: on("post-5"),
  });
  expect(to.url).toBe("/threads/7-slug#post-5");
});
