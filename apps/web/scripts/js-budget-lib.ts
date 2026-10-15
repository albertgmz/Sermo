import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { runInNewContext } from "node:vm";
import { gzipSync } from "node:zlib";

// Client JavaScript per route, read from the `next build` output. A route's first-load script is
// the framework's root files plus the chunks of every entry its tree holds: the layouts, the
// error and not-found boundaries, and the page. The count is the worst case: a chunk behind a
// conditional that never renders is still counted, because the router preloads it with the entry.
// Sizes are gzip (default level) of each distinct chunk, counted once per route. Against the HTML
// a page really sends this is a close estimate, not exact: the router's own two chunks (about 8 KB
// gz, 2%) are missing, and a chunk no one renders (a Base UI button) can be counted. The
// `nomodule` polyfill is left out on purpose: current browsers skip it.

const MANIFEST_SUFFIX = "page_client-reference-manifest.js";

export type RouteWeight = { route: string; chunks: string[]; bytes: number };

export type Budget = { name: string; match: string; maxBytes: number };

export type BudgetFile = { budgets: Budget[] };

export type GroupResult = {
  name: string;
  maxBytes: number;
  routes: RouteWeight[];
  worst: RouteWeight | null;
  over: RouteWeight[];
};

export type CheckResult = {
  groups: GroupResult[];
  unmatched: string[];
  emptyBudgets: string[];
  ok: boolean;
};

type RscManifest = { entryJSFiles?: Record<string, string[]> };

function manifestFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...manifestFiles(path));
    else if (entry.name === MANIFEST_SUFFIX) out.push(path);
  }
  return out;
}

function readManifest(file: string): RscManifest {
  const sandbox: { __RSC_MANIFEST?: Record<string, RscManifest> } = {};
  runInNewContext(readFileSync(file, "utf8"), sandbox);
  const entries = Object.values(sandbox.__RSC_MANIFEST ?? {});
  if (entries.length !== 1)
    throw new Error(`${file}: expected one manifest, found ${entries.length}`);
  return entries[0];
}

// The error page and the built-in not-found are separate documents the visitor does not get with
// the page; they are not part of a route's first load.
function isFirstLoadEntry(key: string): boolean {
  return (
    !key.endsWith("/global-error") &&
    !key.includes("/next/dist/client/components/builtin/")
  );
}

export function measureRoutes(nextDir: string): RouteWeight[] {
  const buildManifest = join(nextDir, "build-manifest.json");
  if (!existsSync(buildManifest))
    throw new Error(`${buildManifest} not found: run the build first`);
  const root: string[] =
    JSON.parse(readFileSync(buildManifest, "utf8")).rootMainFiles ?? [];
  const appDir = join(nextDir, "server", "app");
  if (!existsSync(appDir))
    throw new Error(`${appDir} not found: run the build first`);

  const sizes = new Map<string, number>();
  const size = (chunk: string) => {
    let n = sizes.get(chunk);
    if (n === undefined) {
      n = gzipSync(readFileSync(join(nextDir, chunk))).length;
      sizes.set(chunk, n);
    }
    return n;
  };

  const routes: RouteWeight[] = [];
  for (const file of manifestFiles(appDir)) {
    const route = `/${relative(appDir, file).split(sep).slice(0, -1).join("/")}`;
    if (route.startsWith("/_")) continue;
    const chunks = new Set<string>(root);
    const entries = readManifest(file).entryJSFiles ?? {};
    for (const [key, files] of Object.entries(entries)) {
      if (isFirstLoadEntry(key)) for (const chunk of files) chunks.add(chunk);
    }
    const list = [...chunks].sort();
    routes.push({
      route,
      chunks: list,
      bytes: list.reduce((n, c) => n + size(c), 0),
    });
  }
  return routes.sort((a, b) => a.route.localeCompare(b.route));
}

// The first budget whose pattern matches a route is the one that applies to it, so a specific
// budget goes before a general one. Every route must match one, and every budget must match a
// route: a renamed route or a stale budget fails loudly instead of going unchecked.
export function checkBudgets(
  routes: RouteWeight[],
  file: BudgetFile,
): CheckResult {
  const patterns = file.budgets.map((b) => new RegExp(b.match));
  const groups: GroupResult[] = file.budgets.map((b) => ({
    name: b.name,
    maxBytes: b.maxBytes,
    routes: [],
    worst: null,
    over: [],
  }));
  const unmatched: string[] = [];
  for (const route of routes) {
    const i = patterns.findIndex((p) => p.test(route.route));
    if (i < 0) {
      unmatched.push(route.route);
      continue;
    }
    const group = groups[i];
    group.routes.push(route);
    if (!group.worst || route.bytes > group.worst.bytes) group.worst = route;
    if (route.bytes > group.maxBytes) group.over.push(route);
  }
  const emptyBudgets = groups
    .filter((g) => g.routes.length === 0)
    .map((g) => g.name);
  const ok =
    unmatched.length === 0 &&
    emptyBudgets.length === 0 &&
    groups.every((g) => g.over.length === 0);
  return { groups, unmatched, emptyBudgets, ok };
}

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

export function formatReport(result: CheckResult): string {
  const lines: string[] = [];
  for (const g of result.groups) {
    const worst = g.worst
      ? `${kb(g.worst.bytes)} ${g.worst.route}`
      : "no route";
    lines.push(
      `${g.over.length ? "OVER" : "ok  "} ${g.name}: ${worst} (budget ${kb(g.maxBytes)}, ${g.routes.length} routes)`,
    );
    for (const r of g.over) lines.push(`       ${kb(r.bytes)} ${r.route}`);
  }
  for (const route of result.unmatched) lines.push(`NO BUDGET for ${route}`);
  for (const name of result.emptyBudgets)
    lines.push(`STALE budget ${name} matches no route`);
  return lines.join("\n");
}
