import { WORKER_SCOPE, WORKER_URL } from "./pwa";

type Workers = {
  register(
    url: string,
    options: { scope: string; updateViaCache: "none" },
  ): Promise<unknown>;
};

// Asks the browser to run the service worker. Only a production build has a worker to run (in
// development the route that builds it does not exist), and only a secure origin may have one:
// `https`, or `localhost`. A browser without service workers has nothing to register with. A
// failed registration leaves the site as it was, so the answer is dropped. Returns whether the
// browser was asked.
export function registerWorker(env: {
  production: boolean;
  secure: boolean;
  workers: Workers | undefined;
}) {
  if (!env.production || !env.secure || !env.workers) return false;
  env.workers
    .register(WORKER_URL, { scope: WORKER_SCOPE, updateViaCache: "none" })
    .catch(() => {});
  return true;
}
