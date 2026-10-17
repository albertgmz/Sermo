import { expect, mock, test } from "bun:test";
import {
  getRewrittenUrl,
  isRewrite,
  unstable_doesMiddlewareMatch,
  unstable_getResponseFromNextConfig,
} from "next/experimental/testing/server";

// Next's own routing is asked here: its matching of the rewrites in next.config.ts and of the
// proxy's matcher, not a copy of either.
mock.module("server-only", () => ({}));
const { default: nextConfig } = await import("../next.config");
// A private copy of the module: another suite may have loaded the proxy against its own mocks.
const source = "../src/proxy.ts?backend-paths";
const { config } = (await import(source)) as typeof import("../src/proxy");

// The host the rewrites send to. Next's test helper drops the port of a rewrite's destination, so
// the host name is what is compared.
const API = new URL(process.env.SERMO_API_URL ?? "http://127.0.0.1:8787");

// One address for each path the backend serves, as a crawler, a feed reader or an agent asks.
const BACKEND = [
  "/robots.txt",
  "/llms.txt",
  "/sitemap.xml",
  "/sitemaps/thread-1.xml",
  "/feed.atom",
  "/forums/2/feed.atom",
  "/forums/2-general-chat/feed.atom",
  "/nodes/2/feed.atom",
  "/mcp",
  "/health",
  "/0f3c9a1e.txt",
];

// Pages of the web app, some next to a backend path or sharing its first segment.
const PAGES = [
  "/",
  "/threads/1",
  "/threads/1-hello",
  "/threads/1/feed.atom",
  "/forums/2",
  "/forums/2-general",
  "/forums/2/new",
  "/forums/feed.atom",
  "/members/3",
  "/members/3-ann",
  "/tags/news",
  "/sitemaps",
  "/mcp/tools",
  "/health/db",
  "/es/robots.txt",
];

// The path and query a request is rewritten to on the backend; null when it is not sent there.
const backendPathOf = async (path: string) => {
  const response = await unstable_getResponseFromNextConfig({
    url: `http://localhost${path}`,
    nextConfig,
  });
  const target = isRewrite(response) ? getRewrittenUrl(response) : null;
  if (!target) return null;
  const url = new URL(target);
  return url.hostname === API.hostname ? url.pathname + url.search : target;
};

const proxyRuns = (path: string) =>
  unstable_doesMiddlewareMatch({ config, url: path, nextConfig });

test("each path the backend serves is rewritten to it as it is, query included", async () => {
  for (const path of BACKEND) expect(await backendPathOf(path)).toBe(path);
  expect(await backendPathOf("/sitemap.xml?ref=7")).toBe("/sitemap.xml?ref=7");
});

test("pages are not rewritten to the backend, and the proxy runs for them", async () => {
  for (const path of PAGES) {
    expect(await backendPathOf(path)).toBeNull();
    expect(proxyRuns(path)).toBe(true);
  }
});

test("the API is still rewritten to the backend", async () => {
  expect(await backendPathOf("/api/v1/me")).toBe("/api/v1/me");
});

test("the proxy does not run for a backend path, so no page of a language takes its place", () => {
  for (const path of BACKEND) expect(proxyRuns(path)).toBe(false);
});

// A path added to the rewrites and not to the matcher would be rewritten into `[locale]` by the
// proxy first and served as a page.
test("the proxy's matcher leaves out every backend rewrite", async () => {
  const rewrites = await nextConfig.rewrites?.();
  const sources =
    rewrites && !Array.isArray(rewrites)
      ? (rewrites.beforeFiles ?? []).map((rewrite) => rewrite.source)
      : [];
  expect(sources).toContain("/mcp");
  for (const source of sources) {
    if (source.startsWith("/api/")) continue;
    const example = source.replace(/:\w+/g, "1");
    expect({ source, runs: proxyRuns(example) }).toEqual({
      source,
      runs: false,
    });
  }
});
