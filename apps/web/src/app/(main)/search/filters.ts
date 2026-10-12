// What the address asks for. The forum and the prefix are backend ids; the author is the
// username the visitor typed.
export type Filters = {
  query: string;
  titlesOnly: boolean;
  forum?: number;
  prefix?: number;
  author: string;
};

// The address of a search, with the filters that are set and optionally the cursor of a page.
export function searchHref(filters: Filters, cursor?: string) {
  const params = new URLSearchParams({ q: filters.query });
  if (filters.titlesOnly) params.set("titles", "1");
  if (filters.forum !== undefined) params.set("forum", String(filters.forum));
  if (filters.prefix !== undefined)
    params.set("prefix", String(filters.prefix));
  if (filters.author) params.set("author", filters.author);
  if (cursor) params.set("cursor", cursor);
  return `/search?${params}`;
}
