import { expect, test } from "bun:test";
import {
  cursorHref,
  type ListPage,
  MAX_RESTORED_PAGES,
  pagesParam,
  placeHref,
  restorePages,
  writePlace,
} from "./list-pages";
import { SermoError } from "./sermo/errors";
import { recorded } from "./test-calls";

const page = (nextCursor: string | null): ListPage => ({
  rows: [],
  nextCursor,
});

test("the pages the address asks for are one by default, and never more than the most", () => {
  expect(pagesParam(undefined)).toBe(1);
  expect(pagesParam("")).toBe(1);
  expect(pagesParam("abc")).toBe(1);
  expect(pagesParam("-3")).toBe(1);
  expect(pagesParam("0")).toBe(1);
  expect(pagesParam("3")).toBe(3);
  expect(pagesParam(["4", "2"])).toBe(4);
  expect(pagesParam("999")).toBe(MAX_RESTORED_PAGES);
  expect(pagesParam("99999")).toBe(MAX_RESTORED_PAGES);
});

test("the link to the next page adds the cursor to the screen's address", () => {
  expect(cursorHref("/", "a b")).toBe("/?cursor=a%20b");
  expect(cursorHref("/?tab=top", "x")).toBe("/?tab=top&cursor=x");
});

test("the address keeps the number of pages and nothing else of it changes", () => {
  expect(placeHref("/?tab=top", 3)).toBe("/?tab=top&pages=3");
  expect(placeHref("/forums/4?prefix=2&pages=3#top", 5)).toBe(
    "/forums/4?prefix=2&pages=5#top",
  );
  expect(placeHref("/?pages=3", 1)).toBe("/");
  expect(placeHref("/?tab=top&pages=3", 1)).toBe("/?tab=top");
  expect(placeHref("/", 1)).toBe("/");
  // An address that has nothing to change is handed back as it was.
  expect(placeHref("/search?q=a%20b&x=~", 1)).toBe("/search?q=a%20b&x=~");
  expect(placeHref("/", 40)).toBe(`/?pages=${MAX_RESTORED_PAGES}`);
});

test("restoring draws the pages the address asks for, through the cursors, and stops at the end", async () => {
  const more = recorded(async (cursor: string | null) =>
    page(cursor === "c3" ? null : `c${Number((cursor ?? "c0").slice(1)) + 1}`),
  );
  const three = await restorePages(page("c1"), more, 3);
  expect(three).toHaveLength(3);
  expect(more.calls).toEqual([["c1"], ["c2"]]);

  more.calls.length = 0;
  const short = await restorePages(page("c2"), more, 8);
  expect(short).toHaveLength(3);
  expect(more.calls).toHaveLength(2);

  more.calls.length = 0;
  expect(await restorePages(page(null), more, 5)).toHaveLength(1);
  expect(more.calls).toHaveLength(0);
  expect(await restorePages(page("c1"), more, 1)).toHaveLength(1);
  expect(more.calls).toHaveLength(0);
});

test("restoring stops at the first page the backend does not give and draws the pages it has", async () => {
  const more = recorded(async (cursor: string | null) => {
    if (cursor === "c2") throw new SermoError("rate_limited", 429, "slow down");
    return page(`c${Number((cursor ?? "c0").slice(1)) + 1}`);
  });
  const pages = await restorePages(page("c1"), more, 6);
  expect(pages).toHaveLength(2);
  expect(more.calls).toEqual([["c1"], ["c2"]]);
});

test("a failure that is not the backend's is not hidden", async () => {
  const more = async () => {
    throw new Error("boom");
  };
  let raised = false;
  await restorePages(page("c1"), more, 3).catch(() => {
    raised = true;
  });
  expect(raised).toBe(true);
});

// The browser's history as Next leaves it: the method of the instance is Next's, which takes every
// call for a restore of the page (and drops a navigation in flight); the prototype's is the browser's.
test("the place is written with the browser's own method and the entry's state, never through Next's", () => {
  const written: unknown[][] = [];
  const restores: unknown[][] = [];
  class Browser {
    state = { __NA: true };
    replaceState(...args: unknown[]) {
      written.push(args);
    }
  }
  const history = new Browser();
  Object.assign(history, {
    replaceState: (...args: unknown[]) => restores.push(args),
  });
  writePlace(history, "/novedades?pages=2");
  expect(restores).toEqual([]);
  expect(written).toEqual([[{ __NA: true }, "", "/novedades?pages=2"]]);
});
