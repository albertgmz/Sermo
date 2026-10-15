import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";

// The service worker is a file of the build: `public/sw.js`, bundled from `src/worker/sw.ts` with
// esbuild before `next build` (the `build` script) and served by Next like any file of `public/`.
// It is not a route: under `cacheComponents` a route that bundles at request time is not
// prerendered, so the production image, which holds no source, would fail to serve it.
//
// The precache list is the offline page with the hash of its content as the revision, so a
// deploy that changes the page makes every worker replace its copy.

export const OFFLINE_FILE = "public/offline.html";
export const WORKER_SOURCE = "src/worker/sw.ts";
export const RETIRE_SOURCE = "src/worker/sw-retire.ts";
export const WORKER_FILE = "public/sw.js";

export function precacheManifest(root: string) {
  const revision = createHash("sha256")
    .update(readFileSync(join(root, OFFLINE_FILE)))
    .digest("hex")
    .slice(0, 16);
  return [{ url: "/offline.html", revision }];
}

// The worker script as text, for `root` (the folder of the web app). With `retire` it is the worker
// that removes itself and what it kept (`docs/administration.md`, "Retiring the worker").
// `alias` replaces modules, for a test that runs the bundle outside a browser.
export async function bundleWorker(
  root: string,
  retire = false,
  alias: Record<string, string> = {},
) {
  const result = await build({
    entryPoints: [join(root, retire ? RETIRE_SOURCE : WORKER_SOURCE)],
    bundle: true,
    // A classic script: every browser that has service workers can register one.
    format: "iife",
    platform: "browser",
    target: "es2020",
    minify: true,
    write: false,
    alias,
    define: {
      "process.env.NODE_ENV": '"production"',
      ...(retire
        ? {}
        : { "self.__SW_MANIFEST": JSON.stringify(precacheManifest(root)) }),
    },
  });
  return result.outputFiles[0].text;
}
