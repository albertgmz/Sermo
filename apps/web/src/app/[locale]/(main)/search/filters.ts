// What the address asks for. The forum and the prefix are backend ids; the author is the
// username the visitor typed.
export type Filters = {
  query: string;
  titlesOnly: boolean;
  forum?: number;
  prefix?: number;
  author: string;
};

// The parameters of a search's address: the query and the filters that are set. The pager adds the
// page to them.
export function searchParams(filters: Filters) {
  const params: Record<string, string> = { q: filters.query };
  if (filters.titlesOnly) params.titles = "1";
  if (filters.forum !== undefined) params.forum = String(filters.forum);
  if (filters.prefix !== undefined) params.prefix = String(filters.prefix);
  if (filters.author) params.author = filters.author;
  return params;
}

export const SEARCH_PATH = "/search";

// The address of a search, with the filters that are set.
export function searchHref(filters: Filters) {
  return `${SEARCH_PATH}?${new URLSearchParams(searchParams(filters))}`;
}
