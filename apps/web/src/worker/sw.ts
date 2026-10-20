import {
  CacheFirst,
  ExpirationPlugin,
  NetworkOnly,
  type PrecacheEntry,
  Serwist,
} from "serwist";
import {
  notificationOf,
  openTarget,
  RENEW_PATH,
  readPush,
  renewSubscription,
  type ShownNotification,
  type SubscriptionLike,
  type WindowLike,
} from "../lib/push-worker";
import {
  deleteStaleCaches,
  isImmutable,
  isPageNavigation,
  isStaticAsset,
  offlineFallback,
  STATIC_CACHE,
} from "../lib/pwa-routes";

// The service worker, bundled for the browser into `public/sw.js` by `scripts/build-sw.ts`. It has no
// background sync and no offline reading: see `lib/pwa-routes.ts` for what it does with requests and
// `lib/push-worker.ts` for pushes.
type Lasting = { waitUntil(work: Promise<unknown>): void };
declare const self: {
  // The precache list the build injects: the offline page and its revision.
  __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  location: { origin: string };
  registration: {
    pushManager: {
      subscribe(options: {
        userVisibleOnly: boolean;
        applicationServerKey: ArrayBuffer;
      }): Promise<SubscriptionLike>;
    };
    showNotification(
      title: string,
      options: ShownNotification["options"],
    ): Promise<void>;
  };
  clients: {
    matchAll(options: {
      type: "window";
      includeUncontrolled: boolean;
    }): Promise<readonly WindowLike[]>;
    openWindow(url: string): Promise<unknown>;
  };
  addEventListener(type: "activate", listener: (event: Lasting) => void): void;
  addEventListener(
    type: "push",
    listener: (event: Lasting & { data: { text(): string } | null }) => void,
  ): void;
  addEventListener(
    type: "notificationclick",
    listener: (
      event: Lasting & {
        notification: { close(): void; data: { url?: unknown } | null };
      },
    ) => void,
  ): void;
  addEventListener(
    type: "pushsubscriptionchange",
    listener: (
      event: Lasting & {
        oldSubscription?: SubscriptionLike | null;
        newSubscription?: SubscriptionLike | null;
      },
    ) => void,
  ): void;
};

// The install fails as a whole when /offline.html cannot be fetched (a deploy in progress, a
// challenge page in front of the site); the browser tries again on a later visit.
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // `cleanURLs` off: it would also answer `/offline` with the offline page.
  precacheOptions: { cleanupOutdatedCaches: true, cleanURLs: false },
  // An update takes over at once, in the tabs that are open too. That is safe because the worker
  // holds no page and no data: the static files it keeps are named by their content, so a tab
  // from the old build and a worker from the new one never disagree about a file.
  skipWaiting: true,
  clientsClaim: true,
  // No navigation preload: the browser would ask for a page before the worker decides, and
  // for the navigations the worker leaves alone (a file opened in a tab) it would ask twice.
  runtimeCaching: [
    {
      matcher: isStaticAsset,
      handler: new CacheFirst({
        cacheName: STATIC_CACHE,
        plugins: [
          // Only what the server says never changes: a placeholder or an error page that
          // answered a static address is not kept.
          {
            cacheWillUpdate: async ({ response }) =>
              isImmutable(response) ? response : null,
          },
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

self.addEventListener("push", (event) => {
  let text: string | null = null;
  try {
    text = event.data?.text() ?? null;
  } catch {}
  const shown = notificationOf(readPush(text), self.location.origin);
  event.waitUntil(
    self.registration.showNotification(shown.title, shown.options),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    openTarget(event.notification.data?.url, {
      origin: self.location.origin,
      windows: () =>
        self.clients.matchAll({ type: "window", includeUncontrolled: false }),
      openWindow: (url) => self.clients.openWindow(url),
    }),
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    renewSubscription(
      {
        oldSubscription: event.oldSubscription ?? null,
        newSubscription: event.newSubscription ?? null,
      },
      {
        subscribe: (applicationServerKey) =>
          self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey,
          }),
        send: (body) =>
          fetch(RENEW_PATH, {
            method: "POST",
            headers: { "content-type": "application/json" },
            credentials: "same-origin",
            body,
          }),
      },
    ),
  );
});

serwist.addEventListeners();
