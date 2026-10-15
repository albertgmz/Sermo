import { CACHE_PREFIX } from "../lib/pwa-routes";

// The worker that takes the service worker away: `bun run build` writes it as `public/sw.js` when
// SERMO_RETIRE_WORKER=1. A browser that has the real worker finds a new script at the same address,
// installs it, and this one deletes what the worker kept, unregisters itself and is gone.
declare const self: {
  skipWaiting(): void;
  registration: { unregister(): Promise<boolean> };
  addEventListener(
    type: "install" | "activate",
    listener: (event: { waitUntil(work: Promise<unknown>): void }) => void,
  ): void;
};

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // The caches this site's worker made: its own (`sermo-`) and Serwist's (`serwist-`).
      const names = (await caches.keys()).filter(
        (name) =>
          name.startsWith(`${CACHE_PREFIX}-`) || name.startsWith("serwist-"),
      );
      await Promise.all(names.map((name) => caches.delete(name)));
      indexedDB.deleteDatabase("serwist-expiration");
      await self.registration.unregister();
    })(),
  );
});
