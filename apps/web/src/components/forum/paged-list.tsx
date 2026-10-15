import type { ComponentProps } from "react";
import { InfiniteList } from "@/components/forum/infinite-list";
import { type ListPage, restorePages } from "@/lib/list-pages";

// A list on a screen the server draws: the first page, as the screen read it, and as many more as
// the address asks for (`pages`, see `restorePages`), handed to the infinite list as its data. The
// browser asks `more`, a server action, for the pages after those.
export async function PagedList({
  first,
  more,
  pages,
  start,
  ...list
}: {
  first: ListPage;
  more: (cursor: string) => Promise<ListPage>;
  // How many pages the address asks for.
  pages: number;
  // The cursor the first page began at, when the address names one.
  start: string | undefined;
} & Omit<
  ComponentProps<typeof InfiniteList>,
  "stamp" | "start" | "pages" | "loadPage"
>) {
  return (
    <InfiniteList
      {...list}
      start={start ?? null}
      pages={await restorePages(first, more, pages)}
      loadPage={more}
      stamp={Date.now()}
    />
  );
}
