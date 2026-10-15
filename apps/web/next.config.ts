import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  images: { unoptimized: true },
  partialPrefetching: true,
  transpilePackages: ["@sermo/core", "@sermo/api"],
  // One origin for the browser: the API is reached through the web app's own address. The
  // address is read when the config is evaluated (at build time for `next start`).
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/api/:path*",
          destination: `${process.env.SERMO_API_URL ?? "http://127.0.0.1:8787"}/api/:path*`,
        },
      ],
    };
  },
  // The service worker script is checked for a new version on every visit, whatever a cache in
  // front of the app was told.
  async headers() {
    return [
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
