import { expect, test } from "bun:test";
import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import type { ListPage } from "@/lib/list-pages";
import { recorded } from "@/lib/test-calls";
import { withIntl } from "@/lib/test-intl";
import { withQuery } from "@/lib/test-query";
import {
  AUTO_EMPTY_PAGES,
  emptyRun,
  flattenRows,
  holdsState,
  InfiniteList,
  listQueryOptions,
  mergeRefreshed,
  prependFresh,
  watchSentinel,
  withKept,
} from "./infinite-list";

const page = (keys: string[], nextCursor: string | null): ListPage => ({
  rows: keys.map((key) => ({ key, node: <b>{`row ${key}`}</b> })),
  nextCursor,
});

function options(
  loadPage: (cursor: string | null) => Promise<ListPage>,
  pages = [page(["a", "b"], "c1")],
  start: string | null = null,
) {
  return listQueryOptions({
    listKey: ["test"],
    start,
    pages,
    loadPage,
  });
}

// The query as the list uses it, without a screen: an observer on a client of its own.
function observe(opts: ReturnType<typeof options>) {
  const observer = new InfiniteQueryObserver(new QueryClient(), opts);
  const stop = observer.subscribe(() => {});
  return { observer, stop };
}

test("the pages the server drew are the data: nothing is fetched on mount", async () => {
  const loadPage = recorded(async (_cursor: string | null) =>
    page(["x"], null),
  );
  const { observer, stop } = observe(
    options(loadPage, [page(["a", "b"], "c1"), page(["c"], "c2")]),
  );
  await Promise.resolve();
  expect(loadPage.calls).toHaveLength(0);
  const result = observer.getCurrentResult();
  expect(result.data?.pages).toHaveLength(2);
  expect(result.hasNextPage).toBe(true);
  expect(result.isFetching).toBe(false);
  stop();
});

test("the next page is asked for by the cursor the last page named, and appended", async () => {
  const loadPage = recorded(async (cursor: string | null) =>
    cursor === "c1" ? page(["c", "d"], "c2") : page(["e"], null),
  );
  const { observer, stop } = observe(options(loadPage));
  await observer.fetchNextPage();
  expect(loadPage.calls).toEqual([["c1"]]);
  const pages = observer.getCurrentResult().data?.pages ?? [];
  expect(flattenRows(pages).map((row) => row.key)).toEqual([
    "a",
    "b",
    "c",
    "d",
  ]);
  expect(observer.getCurrentResult().hasNextPage).toBe(true);
  stop();
});

test("at the end of the list there is no next page and nothing more is asked for", async () => {
  const loadPage = recorded(async (_cursor: string | null) =>
    page(["z"], null),
  );
  const { observer, stop } = observe(options(loadPage));
  await observer.fetchNextPage();
  expect(observer.getCurrentResult().hasNextPage).toBe(false);
  await observer.fetchNextPage();
  expect(loadPage.calls).toHaveLength(1);
  stop();
});

test("a failed page keeps what is shown and a second try can succeed", async () => {
  let calls = 0;
  const loadPage = recorded(async (_cursor: string | null) => {
    calls += 1;
    if (calls === 1) throw new Error("down");
    return page(["c"], null);
  });
  const { observer, stop } = observe(options(loadPage));
  await observer.fetchNextPage();
  let result = observer.getCurrentResult();
  expect(result.isError).toBe(true);
  expect(result.data?.pages).toHaveLength(1);
  // No automatic retries: one call, then the visitor decides.
  expect(loadPage.calls).toHaveLength(1);
  await observer.fetchNextPage();
  result = observer.getCurrentResult();
  expect(result.isError).toBe(false);
  expect(result.data?.pages).toHaveLength(2);
  stop();
});

test("a list that began at a cursor keeps it as the first page parameter", () => {
  const { observer, stop } = observe(
    options(async () => page([], null), [page(["a"], "c1")], "start"),
  );
  expect(observer.getCurrentResult().data?.pageParams).toEqual(["start"]);
  stop();
});

test("a row a later page repeats is shown once", () => {
  const rows = flattenRows([page(["a", "b"], "c"), page(["b", "c"], null)]);
  expect(rows.map((row) => row.key)).toEqual(["a", "b", "c"]);
});

test("the server's markup holds the first page's rows, in a list, and the link to the next page", () => {
  const loadPage = recorded(async (_cursor: string | null) => page([], null));
  const html = renderToStaticMarkup(
    withIntl(
      withQuery(
        <InfiniteList
          listKey={["test"]}
          stamp={1}
          start={null}
          pages={[page(["a", "b", "c"], "next 1")]}
          loadPage={loadPage}
          hrefBase="/forums/3?prefix=2"
          moreLabel="Next page"
          estimateSize={72}
          as="ul"
        />,
      ),
    ),
  );
  expect(html).toContain("<ul>");
  expect(html.match(/<li /g)).toHaveLength(3);
  for (const key of ["a", "b", "c"]) expect(html).toContain(`row ${key}`);
  expect(html).toContain('data-index="2"');
  // Plain layout until the browser takes over: nothing is positioned or sized.
  expect(html).not.toContain("position:absolute");
  expect(html).not.toContain("translateY");
  expect(html).toContain('href="/forums/3?prefix=2&amp;cursor=next%201"');
  expect(html).toContain("Next page");
  expect(loadPage.calls).toHaveLength(0);
});

test("before the browser takes over, an address that asks for more pages still draws the first page and the link to the second", () => {
  const html = renderToStaticMarkup(
    withIntl(
      withQuery(
        <InfiniteList
          listKey={["test"]}
          stamp={1}
          start={null}
          pages={[page(["a", "b", "c"], "c1"), page(["d", "e"], "c2")]}
          loadPage={async () => page([], null)}
          hrefBase="/"
          moreLabel="More"
          estimateSize={72}
        />,
      ),
    ),
  );
  for (const key of ["a", "b", "c"]) expect(html).toContain(`row ${key}`);
  expect(html).not.toContain("row d");
  expect(html).toContain('href="/?cursor=c1"');
  expect(html).not.toContain("cursor=c2");
});

test("a list at its end draws no link", () => {
  const html = renderToStaticMarkup(
    withIntl(
      withQuery(
        <InfiniteList
          listKey={["test"]}
          stamp={1}
          start={null}
          pages={[page(["a"], null)]}
          loadPage={async () => page([], null)}
          hrefBase="/"
          moreLabel="More"
          estimateSize={72}
        />,
      ),
    ),
  );
  expect(html).not.toContain("<a ");
  expect(html).toContain("row a");
});

// A stand-in for the browser's observer that the test drives.
function fakeObserver() {
  const seen: { rootMargin?: string; disconnected: boolean }[] = [];
  let report: (entries: { isIntersecting: boolean }[]) => void = () => {};
  class Fake {
    state = { rootMargin: "", disconnected: false } as {
      rootMargin?: string;
      disconnected: boolean;
    };
    constructor(
      callback: (entries: { isIntersecting: boolean }[]) => void,
      init?: IntersectionObserverInit,
    ) {
      this.state.rootMargin = init?.rootMargin;
      report = callback;
      seen.push(this.state);
    }
    observe() {}
    disconnect() {
      this.state.disconnected = true;
    }
  }
  return {
    Observer: Fake as unknown as typeof IntersectionObserver,
    seen,
    report: (entries: { isIntersecting: boolean }[]) => report(entries),
  };
}

test("the sentinel asks for the next page once, when it comes near the screen", () => {
  const { Observer, seen, report } = fakeObserver();
  const onVisible = recorded(() => {});
  watchSentinel({} as Element, onVisible, Observer);
  expect(seen[0].rootMargin).toBe("800px 0px");
  report([{ isIntersecting: false }]);
  expect(onVisible.calls).toHaveLength(0);
  report([{ isIntersecting: true }]);
  report([{ isIntersecting: true }]);
  expect(onVisible.calls).toHaveLength(1);
  expect(seen[0].disconnected).toBe(true);
});

test("a sentinel that is let go stops watching, and without an observer nothing breaks", () => {
  const { Observer, seen } = fakeObserver();
  const stop = watchSentinel({} as Element, () => {}, Observer);
  stop();
  expect(seen[0].disconnected).toBe(true);
  expect(() =>
    watchSentinel({} as Element, () => {}, undefined)(),
  ).not.toThrow();
});

// Stand-ins for the elements of a row, with only what `holdsState` asks of them.
function fakeRow(
  parts: {
    fields?: { value?: string; textContent?: string }[];
    media?: boolean;
    holds?: unknown;
  } = {},
) {
  const body = {};
  return {
    ownerDocument: { body },
    contains: (node: unknown) => node === parts.holds,
    querySelectorAll: () => parts.fields ?? [],
    querySelector: () => (parts.media ? {} : null),
  } as unknown as Element;
}

test("a row that holds the focus or typed text stays mounted", () => {
  const focused = {} as Element;
  expect(holdsState(fakeRow({ holds: focused }), focused)).toBe(true);
  expect(holdsState(fakeRow({ fields: [{ value: "half a rep" }] }), null)).toBe(
    true,
  );
  expect(
    holdsState(fakeRow({ fields: [{ textContent: "typed" }] }), null),
  ).toBe(true);
});

// Embeds are on in every row of a long feed for a member who accepts them: keeping those rows
// would keep a live player per row for the whole scroll.
test("a row with a player and nothing else is left to the window", () => {
  expect(holdsState(fakeRow({ media: true }), null)).toBe(false);
});

test("a row with nothing to lose is left to the window", () => {
  const elsewhere = {} as Element;
  expect(holdsState(fakeRow(), null)).toBe(false);
  expect(holdsState(fakeRow(), elsewhere)).toBe(false);
  expect(
    holdsState(
      fakeRow({ fields: [{ value: "  " }, { textContent: "" }] }),
      null,
    ),
  ).toBe(false);
  // The page body holds the focus when nothing does: that is no row's.
  const row = fakeRow();
  const body = (row as unknown as { ownerDocument: { body: Element } })
    .ownerDocument.body;
  expect(holdsState(row, body)).toBe(false);
});

test("the window and the rows to keep make one ordered range", () => {
  expect(withKept([10, 11, 12], [2, 11])).toEqual([2, 10, 11, 12]);
  expect(withKept([3, 4], [])).toEqual([3, 4]);
});

test("a screen drawn again replaces the first pages and keeps the ones loaded beyond", () => {
  const held = {
    pages: [
      page(["a"], "c1"),
      page(["b"], "c2"),
      page(["c"], "c3"),
      page(["d"], null),
    ],
    pageParams: [null, "c1", "c2", "c3"],
  };
  const merged = mergeRefreshed(
    held,
    [page(["a2"], "c1"), page(["b2"], "c2")],
    null,
  );
  expect(merged.pages.map((p) => p.rows[0].key)).toEqual([
    "a2",
    "b2",
    "c",
    "d",
  ]);
  expect(merged.pageParams).toEqual([null, "c1", "c2", "c3"]);
  // A list that began at a cursor keeps it.
  expect(mergeRefreshed(held, [page(["x"], "c1")], "s").pageParams[0]).toBe(
    "s",
  );
  // Nothing held beyond the new pages: the new pages are the list.
  const short = mergeRefreshed(
    { pages: [page(["a"], null)], pageParams: [null] },
    [page(["a"], "c1"), page(["b"], null)],
    null,
  );
  expect(short.pages).toHaveLength(2);
});

test("the first page of a list is asked for by a null cursor, like any other", async () => {
  const loadPage = recorded(async (_cursor: string | null) =>
    page(["x"], null),
  );
  const { observer, stop } = observe(options(loadPage));
  await observer.refetch();
  expect(loadPage.calls[0]).toEqual([null]);
  stop();
});

test("new entries are put in front of the pages held, which stay", () => {
  const held = {
    pages: [page(["c", "d"], "c1"), page(["e"], null)],
    pageParams: [null, "c1"],
  };
  const next = prependFresh(held, page(["a", "b", "c"], "c0"), null);
  expect(next.pages.map((p) => p.rows.map((r) => r.key))).toEqual([
    ["a", "b", "c"],
    ["c", "d"],
    ["e"],
  ]);
  expect(next.pageParams).toEqual([null, null, "c1"]);
  // The list still ends where it did.
  expect(next.pages.at(-1)?.nextCursor).toBeNull();
  expect(flattenRows(next.pages).map((r) => r.key)).toEqual([
    "a",
    "b",
    "c",
    "d",
    "e",
  ]);
});

test("more new entries than a page holds begin the list again from the newest page, losing none", () => {
  const held = {
    pages: [page(["c", "d"], "c1"), page(["e"], null)],
    pageParams: [null, "c1"],
  };
  // Fifteen new entries fill the page and the row the list began with is further down.
  const keys = Array.from({ length: 15 }, (_, i) => `n${i}`);
  const next = prependFresh(held, page(keys, "c9"), null);
  expect(next.pages).toHaveLength(1);
  expect(next.pageParams).toEqual([null]);
  expect(next.pages[0].nextCursor).toBe("c9");
  expect(flattenRows(next.pages).map((r) => r.key)).toEqual(keys);
});

test("a held first row that was bumped does not make a page complete: the entries below it may be missing", () => {
  const held = {
    pages: [page(["T1", "T2", "T3"], "c1")],
    pageParams: [null],
  };
  // T1 got a reply and is first again, but thirty entries are new and the page holds five.
  const next = prependFresh(
    held,
    page(["T1", "n1", "n2", "n3", "n4"], "c9"),
    null,
  );
  expect(next.pages).toHaveLength(1);
  expect(flattenRows(next.pages).map((r) => r.key)).toEqual([
    "T1",
    "n1",
    "n2",
    "n3",
    "n4",
  ]);
  // The same bump with a page that runs into the held rows is complete and prepended.
  const small = prependFresh(held, page(["T1", "n1", "T2", "T3"], "c9"), null);
  expect(flattenRows(small.pages).map((r) => r.key)).toEqual([
    "T1",
    "n1",
    "T2",
    "T3",
  ]);
  expect(small.pages).toHaveLength(2);
});

test("a short feed that is all new is put in front as it is", () => {
  const held = { pages: [page(["c"], null)], pageParams: [null] };
  const next = prependFresh(held, page(["a", "b"], null), null);
  expect(flattenRows(next.pages).map((r) => r.key)).toEqual(["a", "b", "c"]);
});

test("a thread that moved to the top is shown once, where the newer page has it", () => {
  const held = {
    pages: [page(["a", "b", "c"], "c1")],
    pageParams: [null],
  };
  const fresh = {
    rows: [
      { key: "c", node: <b>newer c</b> },
      { key: "x", node: <b>new x</b> },
      { key: "a", node: <b>newer a</b> },
    ],
    nextCursor: "c9",
  };
  const rows = flattenRows(prependFresh(held, fresh, null).pages);
  expect(rows.map((r) => r.key)).toEqual(["c", "x", "a", "b"]);
  expect(renderToStaticMarkup(rows[0].node)).toBe("<b>newer c</b>");
});

test("the bar of new entries is not in the server's markup, which knows of none", () => {
  const html = renderToStaticMarkup(
    withQuery(
      withIntl(
        <InfiniteList
          listKey={["bar"]}
          stamp={1}
          start={null}
          pages={[page(["a"], null)]}
          loadPage={async () => page(["a"], null)}
          hrefBase="/"
          moreLabel="More"
          estimateSize={100}
          fresh={{
            check: async () => ({ count: 0, more: false }),
            intervalMs: 30_000,
          }}
        />,
      ),
    ),
  );
  expect(html).not.toContain("new post");
});

test("the list follows cursors by itself past at most two empty pages in a row, then waits for the button", () => {
  const empty = page([], "next");
  expect(emptyRun([page(["a"], "c1")])).toBe(0);
  expect(emptyRun([page(["a"], "c1"), empty])).toBe(1);
  expect(emptyRun([empty, empty])).toBe(2);
  expect(emptyRun([empty, page(["a"], "c1"), empty])).toBe(1);
  expect(emptyRun([])).toBe(0);
  expect(AUTO_EMPTY_PAGES).toBe(2);
});
