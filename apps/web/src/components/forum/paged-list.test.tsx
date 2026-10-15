import { expect, test } from "bun:test";
import type { ListPage } from "@/lib/list-pages";
import { recorded } from "@/lib/test-calls";
import { PagedList } from "./paged-list";

const page = (nextCursor: string | null): ListPage => ({
  rows: [],
  nextCursor,
});

test("the infinite list gets the first page and the pages the address asks for as its data", async () => {
  const more = recorded(async (cursor: string) =>
    page(cursor === "c1" ? "c2" : null),
  );
  const element = await PagedList({
    first: page("c1"),
    more,
    pages: 3,
    start: "c0",
    listKey: ["x"],
    hrefBase: "/",
    moreLabel: "More",
    estimateSize: 50,
  });
  expect(element.props.pages).toHaveLength(3);
  expect(element.props.start).toBe("c0");
  expect(element.props.loadPage).toBe(more);
  expect(typeof element.props.stamp).toBe("number");
});

test("a list at the top of its screen starts at no cursor", async () => {
  const element = await PagedList({
    first: page(null),
    more: async () => page(null),
    pages: 1,
    start: undefined,
    listKey: ["x"],
    hrefBase: "/",
    moreLabel: "More",
    estimateSize: 50,
  });
  expect(element.props.start).toBeNull();
  expect(element.props.pages).toHaveLength(1);
});
