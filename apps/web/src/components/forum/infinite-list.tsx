"use client";

import {
  type InfiniteData,
  infiniteQueryOptions,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  defaultRangeExtractor,
  type Range,
  useWindowVirtualizer,
} from "@tanstack/react-virtual";
import { ArrowUp, ChevronDown, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  cursorHref,
  type ListPage,
  type ListRow,
  listId,
  placeHref,
} from "@/lib/list-pages";
import { usePolling } from "@/lib/polling";
import { cn } from "@/lib/utils";

// How the rows of a list are kept apart. The first row of the list never has a separator, whichever
// rows are mounted.
const SPACING = {
  divided: "border-t data-[index=0]:border-t-0",
  spaced: "pt-(--page-gap) data-[index=0]:pt-0",
} as const;

// How far from the sentinel the next page starts to load, so it is there before it is reached.
const LOAD_AHEAD = "800px 0px";

type ListQuery = {
  listKey: readonly (string | number)[];
  // Which draw of the screen the pages are from: a new one (the server drew the screen again)
  // refreshes the pages the list holds.
  stamp: number;
  start: string | null;
  pages: ListPage[];
  // A page by its cursor; null is the first page of a list that began at the top.
  loadPage: (cursor: string | null) => Promise<ListPage>;
};

// Pages in a row, at the end of what is loaded, that held no row. A walk the server filters can
// answer a page with nothing in it and a cursor to go on from; the list follows such cursors by
// itself only so far, then waits for the visitor's press on the button.
export const AUTO_EMPTY_PAGES = 2;
export function emptyRun(pages: ListPage[]) {
  let run = 0;
  for (let at = pages.length - 1; at >= 0 && pages[at]?.rows.length === 0; at--)
    run++;
  return run;
}

// The page parameter of each page: where the list began, then the cursor each page named.
function pageParamsOf(start: string | null, pages: ListPage[]) {
  return [start, ...pages.slice(0, -1).map((page) => page.nextCursor)];
}

// The list after the server drew its screen again (a reply was written, a reaction counted): the
// pages drawn again replace the first ones, and the pages the visitor had loaded beyond them stay,
// so the list does not shrink under them. Rows that came twice are shown once.
export function mergeRefreshed(
  held: InfiniteData<ListPage, unknown>,
  fresh: ListPage[],
  start: string | null,
): InfiniteData<ListPage, unknown> {
  return {
    pages: [...fresh, ...held.pages.slice(fresh.length)],
    pageParams: [
      ...pageParamsOf(start, fresh),
      ...held.pageParams.slice(fresh.length),
    ],
  };
}

// The list with the page of the newest entries put in front of what it holds. The page is
// complete when it runs into what the list holds (its last row is a row held) or when it is the
// end of the feed: everything newer than that row is then in the page. A row that is on both is
// shown once, where the newer page has it (`flattenRows` keeps the first), which is how a thread
// that moved to the top is not shown twice, and the pages the visitor loaded stay. When more is
// new than one page holds, its last row is new too, and some of the new entries would be missing
// between the two (also when the list's first row moved to the top of the page, which says
// nothing of the rows below it): the list then begins again from the newest page (the sentinel
// goes on from there).
export function prependFresh(
  held: InfiniteData<ListPage, unknown>,
  fresh: ListPage,
  start: string | null,
): InfiniteData<ListPage, unknown> {
  const heldKeys = new Set(
    held.pages.flatMap((page) => page.rows.map((row) => row.key)),
  );
  const last = fresh.rows.at(-1)?.key;
  const complete =
    fresh.nextCursor === null || (last !== undefined && heldKeys.has(last));
  if (heldKeys.size > 0 && !complete) {
    return { pages: [fresh], pageParams: [start] };
  }
  return {
    pages: [fresh, ...held.pages],
    pageParams: [start, ...held.pageParams],
  };
}

// The rows to keep mounted whatever the window says: the one that holds the keyboard focus (a
// composer or a picker being used) and the ones with text typed and not sent: both are bounded by
// what the visitor does. Without them a row that scrolls away takes that state with it. A player
// is not kept: where embeds are on, every row of a long feed has one, and keeping them all would
// grow with the scroll; a player that restarts on the way back is the lesser evil.
export function holdsState(row: Element, active: Element | null) {
  if (active && active !== row.ownerDocument.body && row.contains(active)) {
    return true;
  }
  const fields = row.querySelectorAll(
    "textarea, input:not([type=hidden]):not([type=checkbox]):not([type=radio]), [contenteditable=true]",
  );
  for (const field of fields) {
    const text = (field as HTMLInputElement).value ?? field.textContent;
    if (text?.trim()) return true;
  }
  return false;
}

// The indexes the window shows plus those of the rows to keep, in order.
export function withKept(shown: number[], kept: number[]) {
  return [...new Set([...shown, ...kept])].sort((a, b) => a - b);
}

// The query of one list. The pages the server drew are its data from the start, and nothing asks
// the backend again (no refetch on mount, focus or reconnect); the cache holds a list only while
// its screen is mounted, so coming back to a screen always starts from what the server drew.
export function listQueryOptions({
  listKey,
  start,
  pages,
  loadPage,
}: Omit<ListQuery, "stamp">) {
  return infiniteQueryOptions({
    queryKey: ["list", ...listKey, start ?? ""],
    queryFn: ({ pageParam }) => loadPage(pageParam),
    initialPageParam: start,
    getNextPageParam: (last: ListPage) => last.nextCursor,
    initialData: { pages, pageParams: pageParamsOf(start, pages) },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    retry: false,
  });
}

// The rows of all the pages in order. A row a later page repeats (the list moved under the
// visitor) is shown once.
export function flattenRows(pages: ListPage[]) {
  const seen = new Set<string>();
  const rows: ListRow[] = [];
  for (const page of pages) {
    for (const row of page.rows) {
      if (seen.has(row.key)) continue;
      seen.add(row.key);
      rows.push(row);
    }
  }
  return rows;
}

// Calls `onVisible` once, the first time the element comes within `LOAD_AHEAD` of the screen.
// Where the browser has no observer nothing happens: the element is a link the visitor can use.
export function watchSentinel(
  node: Element,
  onVisible: () => void,
  Observer:
    | typeof IntersectionObserver
    | undefined = globalThis.IntersectionObserver,
) {
  if (!Observer) return () => {};
  let done = false;
  const observer = new Observer(
    (entries) => {
      if (done || !entries.some((entry) => entry.isIntersecting)) return;
      done = true;
      observer.disconnect();
      onVisible();
    },
    { rootMargin: LOAD_AHEAD },
  );
  observer.observe(node);
  return () => observer.disconnect();
}

const subscribeNever = () => () => {};

// The heights the rows of a list were drawn at, kept when its screen goes away, so that coming
// back (the Back button) lays the list out as it was and the scroll position lands where it was.
const REMEMBERED_LISTS = 20;
const drawnHeights = new Map<
  string,
  ReturnType<typeof useWindowVirtualizer>["itemSizeCache"]
>();

export function InfiniteList({
  listKey,
  stamp,
  start,
  pages,
  loadPage,
  hrefBase,
  moreLabel,
  estimateSize,
  as = "div",
  spacing = "divided",
  header,
  className,
  moreClassName,
  emptyNote,
  fresh,
}: ListQuery & {
  // The address of the screen, to which `cursor` is added: the link that shows the next page
  // when scripts do not run.
  hrefBase: string;
  moreLabel: string;
  // A guess of a row's height in px; rows are measured once drawn.
  estimateSize: number;
  as?: "ul" | "div";
  spacing?: keyof typeof SPACING;
  // The box around the rows, and what heads it.
  header?: ReactNode;
  className?: string;
  moreClassName?: string;
  // Said above the button while no row is loaded and the list can go on (a filtered walk found
  // nothing in what it looked at); it goes when a row arrives.
  emptyNote?: string;
  // For a list that begins at the newest entry and can ask whether newer ones have come (the
  // feed): `check` is given the time of the newest row held. A bar offers the new entries, which
  // are put in front of the pages held.
  fresh?: {
    check: (
      since: string,
    ) => Promise<{ count: number; more: boolean } | { stop: true }>;
    intervalMs: number;
  };
}) {
  const t = useTranslations("forum.infiniteList");
  const options = listQueryOptions({ listKey, start, pages, loadPage });
  const query = useInfiniteQuery(options);
  const loaded = query.data.pages;
  const client = useQueryClient();
  const drawn = useRef(stamp);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new draw of the screen refreshes
  useEffect(() => {
    if (drawn.current === stamp) return;
    drawn.current = stamp;
    // A page still on its way was asked for before this draw: it is dropped (the sentinel asks
    // again), or its answer would put the older first pages back.
    void client
      .cancelQueries({ queryKey: options.queryKey })
      .then(() =>
        client.setQueryData(options.queryKey, (held) =>
          held ? mergeRefreshed(held, pages, start) : held,
        ),
      );
  }, [stamp]);
  // The server draws the rows of the first page as plain markup; the list switches to windowed
  // layout once it is in the browser, over the same elements. Until then it is that page and the
  // link to the one after it, even when the address asked for more pages.
  const live = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const shown = live ? loaded : loaded.slice(0, 1);
  const rows = useMemo(() => flattenRows(shown), [shown]);
  const nextCursor = shown[shown.length - 1]?.nextCursor ?? null;
  const newestAt = rows[0]?.at;
  const newestRef = useRef(newestAt);
  newestRef.current = newestAt;
  const [waiting, setWaiting] = useState<{
    count: number;
    more: boolean;
  } | null>(null);
  const [showing, setShowing] = useState(false);
  usePolling(
    async () => {
      const since = newestRef.current;
      if (!fresh || !since) return;
      const answer = await fresh.check(since);
      if ("stop" in answer) return "stop";
      setWaiting(answer.count > 0 ? answer : null);
    },
    {
      intervalMs: fresh?.intervalMs ?? 0,
      enabled: fresh !== undefined && live && start === null && !!newestAt,
    },
  );
  async function showNew() {
    setShowing(true);
    try {
      const page = await loadPage(null);
      if (page.rows.length > 0) {
        client.setQueryData(options.queryKey, (held) =>
          held ? prependFresh(held, page, start) : held,
        );
      }
      setWaiting(null);
      // The new entries are at the top of the list, below the header when the page has one.
      const header = Number.parseFloat(
        getComputedStyle(document.documentElement).scrollPaddingTop,
      );
      window.scrollTo({
        top: Math.max(0, scrollMargin - 16 - (header || 0)),
      });
    } catch {
      // The bar stays: pressing it again asks again.
    } finally {
      setShowing(false);
    }
  }
  const box = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const node = box.current;
    if (!node) return;
    const measure = () =>
      setScrollMargin(
        Math.round(node.getBoundingClientRect().top + window.scrollY),
      );
    measure();
    // What sits above the list (a bar that streams in, a wrapped heading) moves it.
    const observer = new ResizeObserver(measure);
    observer.observe(document.documentElement);
    return () => observer.disconnect();
  }, []);
  const memory = listId(listKey, start);
  const [remembered] = useState(() => drawnHeights.get(memory));
  const current = useRef(rows);
  current.current = rows;
  const keepMounted = useCallback((range: Range) => {
    const root = box.current;
    if (!root) return defaultRangeExtractor(range);
    const active = document.activeElement;
    const kept: number[] = [];
    for (const row of root.querySelectorAll("[data-key]")) {
      if (!holdsState(row, active)) continue;
      const key = row.getAttribute("data-key");
      const index = current.current.findIndex((entry) => entry.key === key);
      if (index >= 0) kept.push(index);
    }
    return withKept(defaultRangeExtractor(range), kept);
  }, []);
  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    rangeExtractor: keepMounted,
    estimateSize: (index) => remembered?.get(rows[index].key) ?? estimateSize,
    overscan: 5,
    scrollMargin,
    getItemKey: (index) => rows[index].key,
    // Server and first browser render agree: the first page is in the window, from the top.
    initialRect: { width: 0, height: estimateSize * pages[0].rows.length },
    initialOffset: 0,
  });
  const items = virtualizer.getVirtualItems();

  useEffect(
    () => () => {
      drawnHeights.delete(memory);
      drawnHeights.set(memory, new Map(virtualizer.itemSizeCache));
      // Only the lists visited last are remembered.
      for (const old of drawnHeights.keys()) {
        if (drawnHeights.size <= REMEMBERED_LISTS) break;
        drawnHeights.delete(old);
      }
    },
    [memory, virtualizer],
  );

  // The address keeps the place: the number of pages loaded.
  const count = loaded.length;
  useEffect(() => {
    const here = `${location.pathname}${location.search}${location.hash}`;
    const place = placeHref(here, count);
    if (place !== here) window.history.replaceState(null, "", place);
  }, [count]);

  const sentinel = useRef<HTMLAnchorElement>(null);
  const { fetchNextPage, isFetching } = query;
  const canLoad = query.hasNextPage && !isFetching && !query.isError;
  const follows = canLoad && emptyRun(loaded) < AUTO_EMPTY_PAGES;
  // A new observer reports where the sentinel is at once, so a page too short to push it out of
  // view is followed by the next one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `count` renews the observer after each page
  useEffect(() => {
    const node = sentinel.current;
    if (!follows || !node) return;
    return watchSentinel(node, () => void fetchNextPage());
  }, [follows, count, fetchNextPage]);

  const List = as;
  const Row = as === "ul" ? "li" : "div";
  return (
    <>
      {waiting && (
        // Zero high, so that it appearing moves nothing; it floats over the top of the list.
        <div className="sticky top-[calc(var(--spacing-site-header)+0.5rem)] z-20 h-0">
          <div className="flex justify-center">
            <Button
              type="button"
              className="h-10 rounded-full px-4 shadow-md"
              disabled={showing}
              onClick={() => void showNew()}
            >
              {showing ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <ArrowUp />
              )}
              {t("newRows", {
                count: waiting.count,
                more: String(waiting.more),
              })}
            </Button>
          </div>
        </div>
      )}
      {emptyNote && rows.length === 0 && nextCursor && (
        <p
          role="status"
          className="rounded-lg border bg-card p-4 text-sm text-muted-foreground"
        >
          {emptyNote}
        </p>
      )}
      <div className={className}>
        {header}
        <div
          ref={box}
          style={
            live
              ? { height: virtualizer.getTotalSize(), position: "relative" }
              : undefined
          }
        >
          <List>
            {items.map((item) => (
              <Row
                key={item.key}
                data-index={item.index}
                data-key={item.key}
                ref={virtualizer.measureElement}
                className={SPACING[spacing]}
                style={
                  live
                    ? {
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${item.start - scrollMargin}px)`,
                      }
                    : undefined
                }
              >
                {rows[item.index].node}
              </Row>
            ))}
          </List>
        </div>
      </div>
      {query.isError ? (
        <div
          role="alert"
          className={cn(
            "flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3 text-sm",
            moreClassName,
          )}
        >
          <p className="min-w-0 flex-1 text-muted-foreground">{t("failed")}</p>
          <Button
            type="button"
            variant="outline"
            className="h-10"
            disabled={isFetching}
            onClick={() => void fetchNextPage()}
          >
            {t("retry")}
          </Button>
        </div>
      ) : (
        nextCursor && (
          <div aria-live="polite" className={moreClassName}>
            <a
              ref={sentinel}
              href={cursorHref(hrefBase, nextCursor)}
              className={cn(
                buttonVariants({ variant: "outline" }),
                "h-10 w-full",
              )}
              onClick={(event) => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey)
                  return;
                if (event.shiftKey || event.altKey) return;
                event.preventDefault();
                if (!isFetching) void fetchNextPage();
              }}
            >
              {isFetching ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <ChevronDown />
              )}
              {isFetching ? t("loading") : moreLabel}
            </a>
          </div>
        )
      )}
    </>
  );
}
