import type { ReactNode } from "react";

// One row of a list drawn on the server: its key and what it shows.
export type ListRow = { key: string; node: ReactNode };

// One page of such a list. `nextCursor` is the backend's keyset cursor; null at the end.
export type ListPage = { rows: ListRow[]; nextCursor: string | null };

// The address keeps the visitor's place as `?pages=N`, the number of pages loaded so far. A load
// of that address draws N pages on the server (one read each, in turn), so this is the most it
// brings back; a longer scroll comes back as far as this.
export const MAX_RESTORED_PAGES = 8;

export const PAGES_PARAM = "pages";

// What a list is called in the browser's memory: the query of the list and the cursor it began at.
export function listId(
  listKey: readonly (string | number)[],
  start: string | null,
) {
  return [...listKey, start ?? ""].join("/");
}

// How many pages the address asks for, from the `pages` search param.
export function pagesParam(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d+$/.test(raw)) return 1;
  return Math.min(Math.max(Number(raw), 1), MAX_RESTORED_PAGES);
}

// The address of the same screen with the cursor of a page added: the plain link that works
// without scripts.
export function cursorHref(base: string, cursor: string) {
  const joint = base.includes("?") ? "&" : "?";
  return `${base}${joint}cursor=${encodeURIComponent(cursor)}`;
}

// The address (path, search and hash) with `pages` set to `count`, or removed for one page.
export function placeHref(href: string, count: number) {
  const url = new URL(href, "http://list.invalid");
  // Nothing to say and nothing to take away: the address stays as it is, byte for byte.
  if (count <= 1 && !url.searchParams.has(PAGES_PARAM)) return href;
  if (count > 1) {
    url.searchParams.set(
      PAGES_PARAM,
      String(Math.min(count, MAX_RESTORED_PAGES)),
    );
  } else {
    url.searchParams.delete(PAGES_PARAM);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

// The pages an address asks for: the first one, which the screen has already read, and the next
// ones through `more`, the same function the browser calls when the visitor scrolls. A failure is
// the screen's, as it is for the first page.
export async function restorePages(
  first: ListPage,
  more: (cursor: string) => Promise<ListPage>,
  count: number,
) {
  const pages = [first];
  while (pages.length < count) {
    const cursor = pages[pages.length - 1].nextCursor;
    if (!cursor) break;
    pages.push(await more(cursor));
  }
  return pages;
}
