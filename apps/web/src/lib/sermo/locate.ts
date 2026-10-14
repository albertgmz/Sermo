// How many pages of a list are read to find one item.
const MAX_PAGES = 10;

export type Paged<T> = { items: T[]; nextCursor: string | null };

// Finds, in a list that is read by cursor, the page that holds an item, using the list's own
// reads. `hit` is the cursor that opens that page (none for the first) and the page itself, or
// null when the item is not within the first MAX_PAGES pages or not in the list; `first` is the
// first page, already read, for a caller that falls back to it.
export async function pageHolding<T>(
  readPage: (cursor: string | undefined) => Promise<Paged<T>>,
  holds: (item: T) => boolean,
): Promise<{
  hit: { cursor: string | undefined; page: Paged<T> } | null;
  first: Paged<T>;
}> {
  const first = await readPage(undefined);
  let cursor: string | undefined;
  let page = first;
  for (let pages = 1; ; pages += 1) {
    if (page.items.some(holds)) return { hit: { cursor, page }, first };
    if (page.nextCursor === null || pages >= MAX_PAGES) {
      return { hit: null, first };
    }
    cursor = page.nextCursor;
    page = await readPage(cursor);
  }
}
