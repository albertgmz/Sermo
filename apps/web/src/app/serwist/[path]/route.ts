import { createSerwistRoute } from "@serwist/turbopack";

// Serves the service worker (/serwist/sw.js) built from `app/sw.ts` with esbuild when the app is
// built; Serwist's guide for Turbopack. `dynamic`, `dynamicParams` and `revalidate`, which the
// helper also returns, are not exported: `cacheComponents` refuses them, and this route is
// prerendered anyway because its `generateStaticParams` names every file. The helper answers
// with `Service-Worker-Allowed: /`, so the worker may control the whole site from this folder.
//
// The precache list holds /offline.html only. Serwist's default would also precache every script
// and style of the build: a first visit would download the whole forum, the editor and the panel
// included, which a visitor on the data saver must not pay for. Static files are kept as they are
// used instead (`lib/pwa-routes.ts`).
const { generateStaticParams, GET } = createSerwistRoute({
  swSrc: "src/app/sw.ts",
  globPatterns: ["public/offline.html"],
  // The native binary: the helper otherwise looks for `esbuild-wasm` outside Windows.
  useNativeEsbuild: true,
  // A classic script: every browser that has service workers can register one.
  esbuildOptions: { format: "iife" },
});

export { GET, generateStaticParams };
