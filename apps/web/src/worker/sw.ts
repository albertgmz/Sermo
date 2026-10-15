import {
  CacheFirst,
  ExpirationPlugin,
  NetworkOnly,
  type PrecacheEntry,
  Serwist,
} from "serwist";
import {
  deleteStaleCaches,
  isPageNavigation,
  isStaticAsset,
  offlineFallback,
  STATIC_CACHE,
} from "../lib/pwa-routes";

// The service worker, bundled for the browser into `public/sw.js` by `scripts/build-sw.ts`. It has no
// push, no background sync and no offline reading: see `lib/pwa-routes.ts` for what it does.
declare const self: {
  // The precache list the build injects: the offline page and its revision.
  __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  addEventListener(
    type: "activate",
    listener: (event: { waitUntil(work: Promise<unknown>): void }) => void,
  ): void;
};

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // `cleanURLs` off: it would also answer `/offline` with the offline page.
  precacheOptions: { cleanupOutdatedCaches: true, cleanURLs: false },
  // An update takes over at once, in the tabs that are open too. That is safe because the worker
  // holds no page and no data: the static files it keeps are named by their content, so a tab
  // from the old build and a worker from the new one never disagree about a file.
  skipWaiting: true,
  clientsClaim: true,
  // The worker starts before a page can be asked for; this asks the network at the same time.
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher: isStaticAsset,
      handler: new CacheFirst({
        cacheName: STATIC_CACHE,
        plugins: [
          new ExpirationPlugin({
            maxEntries: 200,
            maxAgeSeconds: 30 * 24 * 60 * 60,
            purgeOnQuotaError: true,
          }),
        ],
      }),
    },
    // A page load goes to the network untouched. It is listed so that a failed one reaches the
    // offline page: Serwist's fallbacks answer for a route whose handler could not respond.
    { matcher: isPageNavigation, handler: new NetworkOnly() },
  ],
  fallbacks: { entries: [offlineFallback] },
});

self.addEventListener("activate", (event) => {
  event.waitUntil(deleteStaleCaches(caches));
});

serwist.addEventListeners();
