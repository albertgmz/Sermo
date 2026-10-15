// What the service worker does with a request, as plain functions so a test can run them
// (`src/app/sw.ts` hands them to Serwist). The worker is deliberately small: it keeps nothing
// that belongs to a member or may be out of date.
//
// - `/_next/static/*` (scripts, styles, fonts: every file has its hash in its name and never
//   changes) is kept and served from the cache first.
// - A page the browser loads goes to the network untouched; only when the network fails does the
//   visitor get the offline page.
// - Everything else (`/api`, files, uploads, Next's own page and data requests, every request that
//   is not a GET) is not touched: the worker does not answer, the browser asks the network itself.

import { OFFLINE_URL } from "./pwa";

export { OFFLINE_URL };

// The prefix of every cache this worker makes by name, and the one that holds the static files.
// Raise the version in the name when what that cache holds changes: the worker deletes the older
// ones when it takes over (`staleCaches`). Serwist keeps the offline page in its own precache
// (`serwist-precache-...`), whose entries it replaces itself when the file's content changes.
export const CACHE_PREFIX = "sermo";
export const STATIC_CACHE = `${CACHE_PREFIX}-static-v1`;

type Matched = {
  request: { mode: string; destination: string };
  url: { pathname: string };
  sameOrigin: boolean;
};

// Registered for GET only, so a POST never reaches it.
export function isStaticAsset({
  url,
  sameOrigin,
}: Pick<Matched, "url" | "sameOrigin">) {
  return sameOrigin && url.pathname.startsWith("/_next/static/");
}

// The browser loading a page (a link followed, an address typed, a reload): `navigate`. Not what
// Next asks for behind a `<Link>`, and not the backend: a file opened in a tab is also a
// navigation, and goes to the network as it is.
export function isPageNavigation({ request, url, sameOrigin }: Matched) {
  return (
    sameOrigin &&
    request.mode === "navigate" &&
    !url.pathname.startsWith("/api/")
  );
}

// The page that answers a failed page load.
export const offlineFallback = {
  url: OFFLINE_URL,
  matcher: ({ request }: Pick<Matched, "request">) =>
    request.destination === "document",
};

// The caches an older worker made that the current one does not use.
export function staleCaches(names: string[]) {
  return names.filter(
    (name) => name.startsWith(`${CACHE_PREFIX}-`) && name !== STATIC_CACHE,
  );
}

export async function deleteStaleCaches(store: {
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
}) {
  await Promise.all(
    staleCaches(await store.keys()).map((name) => store.delete(name)),
  );
}
