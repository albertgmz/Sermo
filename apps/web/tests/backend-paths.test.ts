import { expect, mock, test } from "bun:test";
import { tryToParsePath } from "next/dist/lib/try-to-parse-path";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { OPENSEARCH_URL } from "@/lib/opensearch";

// The rewrites of next.config.ts and the proxy's matcher are read as they are and matched the way
// Next matches them: a rewrite's source by `getPathMatch` with the options of the server's
// `buildCustomRoute` (server/lib/router-utils/filesystem.js), the matcher by the regular
// expression of Next's `tryToParsePath` (Next also lets `/_next/data/...` and `.rsc` forms of a
// path through, which none of these addresses is).
// Next's own testing helpers are not used: they leave Next's request storage set up for every
// other suite of the run.
mock.module("server-only", () => ({}));
const { default: nextConfig } = await import("../next.config");
// A private copy of the module: another suite may have loaded the proxy against its own mocks.
const source = "../src/proxy.ts?backend-paths";
const { config } = (await import(source)) as typeof import("../src/proxy");

const API = process.env.SERMO_API_URL ?? "http://127.0.0.1:8787";

const rewrites = await (async () => {
  const all = await nextConfig.rewrites?.();
  return all && !Array.isArray(all) ? (all.beforeFiles ?? []) : [];
})();

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

// The source of the first rewrite that takes this path, as Next tries them in order.
const rewriteOf = (path: string) =>
  rewrites.find(
    (rewrite) =>
      getPathMatch(rewrite.source, { strict: true, removeUnnamedParams: true })(
        path,
      ) !== false,
  )?.source;

const matcher = new RegExp(
  tryToParsePath(config.matcher[0]).regexStr ?? "(?!)",
);
const proxyRuns = (path: string) => matcher.test(path);

test("every rewrite goes to the same path on the backend", () => {
  expect(rewrites.map((rewrite) => rewrite.source)).toContain("/mcp");
  for (const rewrite of rewrites)
    expect(rewrite.destination).toBe(`${API}${rewrite.source}`);
});

test("each path the backend serves is rewritten to it", () => {
  for (const path of BACKEND) {
    const source = rewriteOf(path);
    const rewritten = source !== undefined && !source.startsWith("/api/");
    expect({ path, rewritten }).toEqual({ path, rewritten: true });
  }
});

test("pages are not rewritten to the backend, and the proxy runs for them", () => {
  for (const path of PAGES) {
    expect({ path, source: rewriteOf(path) }).toEqual({
      path,
      source: undefined,
    });
    expect({ path, runs: proxyRuns(path) }).toEqual({ path, runs: true });
  }
});

test("the API is still rewritten to the backend", () => {
  expect(rewriteOf("/api/v1/me")).toBe("/api/:path*");
});

test("the proxy does not run for a backend path, so no page of a language takes its place", () => {
  for (const path of BACKEND)
    expect({ path, runs: proxyRuns(path) }).toEqual({ path, runs: false });
});

test("the proxy does not run for the OpenSearch description, a file of the web app", () => {
  expect(proxyRuns(OPENSEARCH_URL)).toBe(false);
  expect(rewriteOf(OPENSEARCH_URL)).toBeUndefined();
});

test("the proxy does not run for the share cards, files of the web app", () => {
  for (const path of [
    "/og/site",
    "/og/threads/12",
    "/og/forums/3",
    "/og/members/4",
  ]) {
    expect({ path, runs: proxyRuns(path) }).toEqual({ path, runs: false });
    expect({ path, source: rewriteOf(path) }).toEqual({
      path,
      source: undefined,
    });
  }
  // A page whose address only starts the same way is still a page.
  expect(proxyRuns("/ogham")).toBe(true);
});

// A path added to the rewrites and not to the matcher would be rewritten into `[locale]` by the
// proxy first and served as a page.
test("the proxy's matcher leaves out every backend rewrite", () => {
  for (const { source } of rewrites) {
    if (source.startsWith("/api/")) continue;
    // A named segment, or a run of them (`:path*`), stands for one segment here.
    const example = source.replace(/:\w+[*+?]?/g, "1");
    expect({ source, runs: proxyRuns(example) }).toEqual({
      source,
      runs: false,
    });
  }
});
