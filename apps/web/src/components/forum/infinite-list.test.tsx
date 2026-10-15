import { expect, test } from "bun:test";
import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import type { ListPage } from "@/lib/list-pages";
import { recorded } from "@/lib/test-calls";
import { withIntl } from "@/lib/test-intl";
import { withQuery } from "@/lib/test-query";
import {
  flattenRows,
  holdsState,
  InfiniteList,
  listQueryOptions,
  mergeRefreshed,
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

test("a row that holds the focus, typed text, a loaded embed or a player stays mounted", () => {
  const focused = {} as Element;
  expect(holdsState(fakeRow({ holds: focused }), focused)).toBe(true);
  expect(holdsState(fakeRow({ fields: [{ value: "half a rep" }] }), null)).toBe(
    true,
  );
  expect(
    holdsState(fakeRow({ fields: [{ textContent: "typed" }] }), null),
  ).toBe(true);
  expect(holdsState(fakeRow({ media: true }), null)).toBe(true);
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
