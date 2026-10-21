import { PICTURE_PARAM } from "@/components/forum/picture-ref";
import { NOVEDADES_PATH } from "@/lib/home-tabs";
import { PAGES_PARAM } from "@/lib/list-pages";

// The home page used to be the feed, with the forum list as its Forums tab and on `/forums`
// (where `tab` named a section). The home page is now the forum list and the feed is on
// `/novedades`; the old addresses go to their page for good, with the rest of their query.

// What only the feed reads on its page: the list's place and the filters of `feed-filters.ts`.
const FEED_KEYS = [
  "cursor",
  PAGES_PARAM,
  PICTURE_PARAM,
  "forums",
  "prefix",
  "type",
  "tag",
  "watched",
  "unread",
];

const withQuery = (path: string, params: URLSearchParams) => {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
};

// The address an old home or forum list address now lives at, or undefined when it is current.
// `search` is the query as written, with its `?`.
export function homeRedirectTarget(
  pathname: string,
  search: string,
): string | undefined {
  const params = new URLSearchParams(search);
  if (pathname === "/forums" || pathname === "/forums/") {
    // `/forums?tab=x&stats=y` is `/?section=x&stats=y`.
    const section = params.getAll("tab");
    params.delete("tab");
    for (const value of section) params.append("section", value);
    return withQuery("/", params);
  }
  if (pathname !== "/") return undefined;
  const tab = params.get("tab");
  if (tab === "forums") {
    // The Forums tab already carried `section` and `stats`.
    params.delete("tab");
    return withQuery("/", params);
  }
  if (tab !== null || FEED_KEYS.some((key) => params.has(key)))
    return withQuery(NOVEDADES_PATH, params);
  return undefined;
}
