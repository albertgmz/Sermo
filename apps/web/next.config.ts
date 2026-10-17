import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

// What the backend serves at the site's own address besides the API (the paths the Caddyfile sends
// to it): the files for crawlers and agents, the feeds, the MCP endpoint and the health check. The
// proxy's matcher (src/proxy.ts) leaves the same paths out, and tests/backend-paths.test.ts keeps
// the two in step. A `/.well-known/` file the backend serves is added to both.
const BACKEND_PATHS = [
  "/robots.txt",
  "/llms.txt",
  "/sitemap.xml",
  "/sitemaps/:name",
  "/feed.atom",
  "/forums/:id/feed.atom",
  "/nodes/:id/feed.atom",
  "/mcp",
  "/health",
  // The IndexNow key file, `/<key>.txt`.
  "/:key.txt",
];

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // The staging build (scripts/staging.ts) writes to its own folder, so `check:web` leaves it alone.
  distDir: process.env.SERMO_DIST_DIR || ".next",
  // The page's script registers the service worker, except in the build that retires it.
  env: {
    SERMO_RETIRE_WORKER: process.env.SERMO_RETIRE_WORKER === "1" ? "1" : "",
  },
  images: { unoptimized: true },
  partialPrefetching: true,
  poweredByHeader: false,
  transpilePackages: ["@sermo/core", "@sermo/api"],
  // One origin for the browser: the API and the backend's other paths are reached through the web
  // app's own address, ahead of any page. The address is read when the config is evaluated (at
  // build time for `next start`).
  async rewrites() {
    const api = process.env.SERMO_API_URL ?? "http://127.0.0.1:8787";
    return {
      beforeFiles: ["/api/:path*", ...BACKEND_PATHS].map((source) => ({
        source,
        destination: `${api}${source}`,
      })),
    };
  },
  // The service worker script is checked for a new version on every visit, whatever a cache in
  // front of the app was told. Every answer, the files the proxy skips included, is read as the type
  // it says it is; pages get the rest of their security headers from the proxy
  // (src/lib/security-headers.ts).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Content-Type-Options", value: "nosniff" }],
      },
      {
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache" }],
      },
    ];
  },
  experimental: {
    // The proxy copies a request body to read it twice, up to this size. Actions take 1 MB at the
    // most and a picture goes through its own route, which the proxy skips.
    proxyClientMaxBodySize: "1mb",
    instantInsights: {
      validationLevel: "manual-warning",
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default withNextIntl(nextConfig);
