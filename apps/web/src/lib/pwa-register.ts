import { WORKER_SCOPE, WORKER_URL } from "./pwa";

type Workers = {
  register(
    url: string,
    options: { scope: string; updateViaCache: "none" },
  ): Promise<unknown>;
};

// Asks the browser to run the service worker. Only a production build has a worker to run
// (`bun run build` writes public/sw.js; a development checkout has none), and only a secure origin
// may have one: `https`, or `localhost`. A browser without service workers has nothing to register
// with. The build that retires the worker (`retire`) registers nothing: devices that have the worker
// find the new `/sw.js` when they load a page and remove it, and a device without it must not
// install the retiring one on every visit. A failed registration leaves the site as it was, so the
// answer is dropped. Returns whether the browser was asked.
export function registerWorker(env: {
  production: boolean;
  retire: boolean;
  secure: boolean;
  workers: Workers | undefined;
}) {
  if (!env.production || env.retire || !env.secure || !env.workers)
    return false;
  env.workers
    .register(WORKER_URL, { scope: WORKER_SCOPE, updateViaCache: "none" })
    .catch(() => {});
  return true;
}
