"use client";

import { infiniteQueryOptions, useInfiniteQuery } from "@tanstack/react-query";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type ReactNode,
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
  placeHref,
} from "@/lib/list-pages";
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
  stamp: number;
  start: string | null;
  pages: ListPage[];
  loadPage: (cursor: string) => Promise<ListPage>;
};

// The query of one list. The pages the server drew are its data from the start, and nothing asks
// the backend again (no refetch on mount, focus or reconnect); the cache holds a list only while
// its screen is mounted, so coming back to a screen always starts from what the server drew. The
// render's stamp is in the key: a screen the server drew again (after a write, say) is a new list.
export function listQueryOptions({
  listKey,
  stamp,
  start,
  pages,
  loadPage,
}: ListQuery) {
  return infiniteQueryOptions({
    queryKey: ["list", ...listKey, start ?? "", stamp],
    queryFn: ({ pageParam }) => {
      if (pageParam === null) {
        throw new Error("The first page of a list comes from the server.");
      }
      return loadPage(pageParam);
    },
    initialPageParam: start,
    getNextPageParam: (last: ListPage) => last.nextCursor,
    initialData: {
      pages,
      pageParams: [start, ...pages.slice(0, -1).map((page) => page.nextCursor)],
    },
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
}) {
  const t = useTranslations("forum.infiniteList");
  const query = useInfiniteQuery(
    listQueryOptions({ listKey, stamp, start, pages, loadPage }),
  );
  const loaded = query.data.pages;
  const rows = useMemo(() => flattenRows(loaded), [loaded]);
  const nextCursor = loaded[loaded.length - 1]?.nextCursor ?? null;

  // The server draws the rows of the first page as plain markup; the list switches to windowed
  // layout once it is in the browser, over the same elements.
  const live = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
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
  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => estimateSize,
    overscan: 5,
    scrollMargin,
    getItemKey: (index) => rows[index].key,
    // Server and first browser render agree: the first page is in the window, from the top.
    initialRect: { width: 0, height: estimateSize * pages[0].rows.length },
    initialOffset: 0,
  });
  const items = virtualizer.getVirtualItems();

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
  // A new observer reports where the sentinel is at once, so a page too short to push it out of
  // view is followed by the next one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `count` renews the observer after each page
  useEffect(() => {
    const node = sentinel.current;
    if (!canLoad || !node) return;
    return watchSentinel(node, () => void fetchNextPage());
  }, [canLoad, count, fetchNextPage]);

  const List = as;
  const Row = as === "ul" ? "li" : "div";
  return (
    <>
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
          <List
            style={
              live
                ? {
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${(items[0]?.start ?? 0) - scrollMargin}px)`,
                  }
                : undefined
            }
          >
            {items.map((item) => (
              <Row
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className={SPACING[spacing]}
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
