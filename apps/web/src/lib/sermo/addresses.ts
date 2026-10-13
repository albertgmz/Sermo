// The addresses of the three public page kinds: `/forums/<id>-<slug>`, `/threads/<id>-<slug>` and
// `/members/<id>-<slug>`. The backend decides the canonical form (its SEO reads answer with it);
// this file is the only one that knows the backend's name for forums.

// This app's name for forums, in every address it serves and links to.
export const FORUM_PREFIX = "forums";
// The name the backend's canonical addresses and SEO reads use for forums.
export const BACKEND_FORUM_PREFIX = "nodes";
// An older name for forums whose addresses are still out there; they are sent to the current one.
export const LEGACY_FORUM_PREFIX = "nodes";

function swapPrefix(path: string, from: string, to: string) {
  const prefix = `/${from}`;
  if (path !== prefix && !path.startsWith(`${prefix}/`)) return path;
  return `/${to}${path.slice(prefix.length)}`;
}

// An address of this app in the form the backend's SEO reads expect.
export const toBackendPath = (path: string) =>
  swapPrefix(path, FORUM_PREFIX, BACKEND_FORUM_PREFIX);

// A canonical address from the backend (absolute) with this app's name for forums.
export function canonicalUrlOf(canonical: string): string {
  const url = new URL(canonical);
  url.pathname = swapPrefix(url.pathname, BACKEND_FORUM_PREFIX, FORUM_PREFIX);
  return url.href;
}

// The same as the path this app serves, with its query.
export function canonicalPathOf(canonical: string): string {
  const { pathname, search } = new URL(canonicalUrlOf(canonical));
  return pathname + search;
}
