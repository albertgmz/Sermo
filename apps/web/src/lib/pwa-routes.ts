// What the service worker does with a request, as plain functions so a test can run them
// (`src/worker/sw.ts` hands them to Serwist). The worker is deliberately small: it keeps nothing
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
// Raise the version in the name only when the way the files are kept changes: the worker deletes
// the older caches when it takes over (`staleCaches`), and a tab still open on the previous deploy
// then loses the lazy chunks it had cached and not yet loaded (it asks the server, which no longer
// has them, and gets a 404). A new deploy does not need a bump: the files are named by their
// content, and the cache drops the oldest after 200 files or 30 days. Serwist keeps the offline
// page in its own precache (`serwist-precache-...`), whose entries it replaces itself when the
// file's content changes.
export const CACHE_PREFIX = "sermo";
export const STATIC_CACHE = `${CACHE_PREFIX}-static-v1`;

type Matched = {
  request: { mode: string; destination: string };
  url: { pathname: string };
  sameOrigin: boolean;
};

// A picture under that prefix is the data saver's business: the proxy answers it with a placeholder
// while LITE mode is on, and the worker must neither keep that placeholder nor answer a real
// picture from the cache once LITE is on. The extensions are those of `lite-images.ts`.
const PICTURE =
  /\.(?:avif|apng|bmp|gif|heic|heif|ico|jfif|jpe?g|png|svg|tiff?|webp)[. ]*$/i;

// Registered for GET only, so a POST never reaches it.
export function isStaticAsset({
  url,
  sameOrigin,
}: Pick<Matched, "url" | "sameOrigin">) {
  return (
    sameOrigin &&
    url.pathname.startsWith("/_next/static/") &&
    !PICTURE.test(decodeURIComponentSafe(url.pathname))
  );
}

function decodeURIComponentSafe(path: string) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

// Next sends its hashed files with `immutable` and the placeholder with `no-store`: only the first
// is worth keeping for a month.
export function isImmutable(response: {
  headers: { get(name: string): string | null };
}) {
  return /(?:^|[\s,])immutable(?:$|[\s,])/i.test(
    response.headers.get("cache-control") ?? "",
  );
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
