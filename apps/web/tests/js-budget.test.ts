import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  checkBudgets,
  formatReport,
  measureRoutes,
} from "../scripts/js-budget-lib";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

// Text that does not shrink much, so the gzip sizes of the fixture chunks differ clearly.
const noise = (n: number, seed: number) => {
  let x = seed;
  let out = "";
  while (out.length < n) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += x.toString(36);
  }
  return out.slice(0, n);
};

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "js-budget-"));
  dirs.push(dir);
  const chunks: Record<string, string> = {
    "static/chunks/root.js": noise(3000, 1),
    "static/chunks/layout.js": noise(2000, 2),
    "static/chunks/thread.js": noise(5000, 3),
    "static/chunks/search.js": noise(1000, 4),
    "static/chunks/error.js": noise(500, 5),
    "static/chunks/shared.js": noise(700, 6),
  };
  mkdirSync(join(dir, "static/chunks"), { recursive: true });
  for (const [path, body] of Object.entries(chunks))
    writeFileSync(join(dir, path), body);
  writeFileSync(
    join(dir, "build-manifest.json"),
    JSON.stringify({ rootMainFiles: ["static/chunks/root.js"] }),
  );
  const route = (path: string, page: string[]) => {
    const folder = join(dir, "server/app", path);
    mkdirSync(folder, { recursive: true });
    const entries = {
      "[project]/node_modules/next/dist/client/components/builtin/not-found": [
        "static/chunks/error.js",
      ],
      "[project]/apps/web/src/app/global-error": ["static/chunks/error.js"],
      "[project]/apps/web/src/app/[locale]/layout": [
        "static/chunks/layout.js",
        "static/chunks/shared.js",
      ],
      [`[project]/apps/web/src/app/${path}/page`]: [
        ...page,
        "static/chunks/shared.js",
      ],
    };
    const source = `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};\nglobalThis.__RSC_MANIFEST["/${path}/page"] = ${JSON.stringify({ entryJSFiles: entries })};`;
    writeFileSync(join(folder, "page_client-reference-manifest.js"), source);
  };
  route("[locale]/(main)/threads/[id]", ["static/chunks/thread.js"]);
  route("[locale]/(main)/search", ["static/chunks/search.js"]);
  route("_not-found", []);
  return dir;
}

const gz = (body: string) => gzipSync(body).length;

test("a route weighs the root files plus each distinct entry chunk, gzipped, once", () => {
  const routes = measureRoutes(fixture());
  expect(routes.map((r) => r.route)).toEqual([
    "/[locale]/(main)/search",
    "/[locale]/(main)/threads/[id]",
  ]);
  const base = gz(noise(3000, 1)) + gz(noise(2000, 2)) + gz(noise(700, 6));
  expect(routes[0].bytes).toBe(base + gz(noise(1000, 4)));
  expect(routes[1].bytes).toBe(base + gz(noise(5000, 3)));
  // The error and not-found entries are not part of the first load.
  expect(routes[1].chunks).toEqual([
    "static/chunks/layout.js",
    "static/chunks/root.js",
    "static/chunks/shared.js",
    "static/chunks/thread.js",
  ]);
});

const budgets = (thread: number, search: number) => ({
  budgets: [
    {
      name: "thread",
      match: "^/\\[locale\\]/\\(main\\)/threads/",
      maxBytes: thread,
    },
    { name: "other", match: "^/\\[locale\\]/\\(main\\)/", maxBytes: search },
  ],
});

test("routes under their budgets pass", () => {
  const routes = measureRoutes(fixture());
  const result = checkBudgets(
    routes,
    budgets(routes[1].bytes, routes[0].bytes),
  );
  expect(result.ok).toBe(true);
  expect(formatReport(result)).toContain("ok   thread");
});

test("a route one byte over its budget fails and is named", () => {
  const routes = measureRoutes(fixture());
  const result = checkBudgets(
    routes,
    budgets(routes[1].bytes - 1, routes[0].bytes),
  );
  expect(result.ok).toBe(false);
  expect(result.groups[0].over.map((r) => r.route)).toEqual([
    "/[locale]/(main)/threads/[id]",
  ]);
  expect(result.groups[1].over).toEqual([]);
  expect(formatReport(result)).toContain("OVER thread");
});

test("a route with no budget fails", () => {
  const routes = measureRoutes(fixture());
  const result = checkBudgets(routes, {
    budgets: [{ name: "thread", match: "/threads/", maxBytes: 1e9 }],
  });
  expect(result.ok).toBe(false);
  expect(result.unmatched).toEqual(["/[locale]/(main)/search"]);
});

test("a budget that matches no route fails", () => {
  const routes = measureRoutes(fixture());
  const result = checkBudgets(routes, {
    budgets: [
      { name: "all", match: ".*", maxBytes: 1e9 },
      { name: "gone", match: "/members/", maxBytes: 1e9 },
    ],
  });
  expect(result.ok).toBe(false);
  expect(result.emptyBudgets).toEqual(["gone"]);
});

test("the first matching budget applies to a route", () => {
  const routes = measureRoutes(fixture());
  const result = checkBudgets(routes, {
    budgets: [
      { name: "specific", match: "/threads/", maxBytes: 1 },
      { name: "general", match: ".*", maxBytes: 1e9 },
    ],
  });
  expect(result.groups[0].routes.length).toBe(1);
  expect(result.groups[1].routes.length).toBe(1);
});

test("a missing build says to run the build first", () => {
  const dir = mkdtempSync(join(tmpdir(), "js-budget-"));
  dirs.push(dir);
  expect(() => measureRoutes(dir)).toThrow("run the build first");
});
