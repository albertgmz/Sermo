// How many pages of a list are read to find one item.
const MAX_PAGES = 20;

export type Paged<T> = { items: T[]; nextCursor: string | null };

// Finds, in a list that is read by cursor, the page that holds an item, using the list's own
// reads: the cursor that opens the page (none for the first) and the page itself. Null when the
// item is not within the first MAX_PAGES pages, or not in the list.
export async function pageHolding<T>(
  readPage: (cursor: string | undefined) => Promise<Paged<T>>,
  holds: (item: T) => boolean,
): Promise<{ cursor: string | undefined; page: Paged<T> } | null> {
  let cursor: string | undefined;
  for (let pages = 0; pages < MAX_PAGES; pages += 1) {
    const page = await readPage(cursor);
    if (page.items.some(holds)) return { cursor, page };
    if (page.nextCursor === null) return null;
    cursor = page.nextCursor;
  }
  return null;
}
