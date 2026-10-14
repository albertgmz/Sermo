// Where a link to a place on a page leads, decided from the address shown and the page's content.

export type HashLinkTarget = {
  // The link stays on the page being read: its address keeps the path and the query as they are.
  samePage: boolean;
  // The address to go to: path, query and hash, with no stray `?`.
  url: string;
  hash: string;
};

// A link written as a bare hash (`#reply`) is always on the page. One written as a full address
// (`/threads/7?page=2#post-43`) is on the page when the element it names is there: a post of the
// page being read, whatever the query that shows it (a page number, a cursor, a selection).
export function hashLinkTarget(link: {
  href: string;
  here: { href: string; pathname: string; search: string };
  hasElement: (id: string) => boolean;
}): HashLinkTarget {
  const to = new URL(link.href, link.here.href);
  const samePage =
    link.href.startsWith("#") ||
    (to.hash.length > 1 &&
      link.hasElement(decodeURIComponent(to.hash.slice(1))));
  const url = samePage
    ? `${link.here.pathname}${link.here.search}${to.hash}`
    : `${to.pathname}${to.search}${to.hash}`;
  return { samePage, url, hash: to.hash };
}
