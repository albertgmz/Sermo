import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

// A server action that returns UI (`loadMemberCard`, `loadReactionUsers`, the audited reads of the
// moderation pages) sends React references to client components. React can only serialise a
// reference to one that the route's client reference manifest lists, and Next lists only the client
// modules that a server module of that route imports (the route's layouts and page; what a server
// action imports does not count). A production build answers the missing one with React error #441
// (an error in the Server Components render, its message left out) in the browser's console. A
// development server has one manifest for everything and never shows it. This walks the staff
// routes the way Next builds the lists and fails when a client component an action can send is not
// in a route that offers the action.
const SRC = resolve(import.meta.dir, "../src");
const STAFF = join(SRC, "app/[locale]/(staff)");
const LAYOUTS = [
  join(SRC, "app/[locale]/layout.tsx"),
  join(STAFF, "layout.tsx"),
];

function target(spec: string, from: string) {
  const base = spec.startsWith("@/")
    ? resolve(SRC, spec.slice(2))
    : spec.startsWith(".")
      ? resolve(dirname(from), spec)
      : null;
  if (!base) return undefined;
  return [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]
    .concat(base)
    .find((file) => /\.tsx?$/.test(file) && existsSync(file));
}

// Every module a file loads: named, default and side-effect imports, and re-exports (not type-only).
function specifiers(source: string) {
  const found: string[] = [];
  const patterns = [
    /^\s*(?:import|export)\s(?!type\s)[^;]*?\sfrom\s+["']([^"']+)["']/gm,
    /^\s*import\s+["']([^"']+)["']/gm,
  ];
  for (const pattern of patterns)
    for (const match of source.matchAll(pattern))
      found.push(match[1] as string);
  return found;
}

// The client modules reachable from `start` through server modules. The walk stops at each client
// module, and at a server action module (what it imports is not the route's).
function clientModules(start: string) {
  const seen = new Set<string>();
  const found = new Set<string>();
  const walk = (file: string, top: boolean) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    if (/^\s*["']use client["']/.test(source)) {
      found.add(file);
      return;
    }
    if (!top && /^\s*["']use server["']/.test(source)) return;
    for (const spec of specifiers(source)) {
      const next = target(spec, file);
      if (next) walk(next, false);
    }
  };
  walk(start, true);
  return found;
}

function pages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? pages(join(dir, entry.name))
      : entry.name === "page.tsx"
        ? [join(dir, entry.name)]
        : [],
  );
}

// What the route of a page lists: the client modules of its layouts and of the page itself.
function routeList(page: string) {
  const list = new Set<string>();
  for (const file of [...LAYOUTS, page])
    for (const client of clientModules(file)) list.add(client);
  return list;
}

const name = (file: string) => relative(SRC, file);

// [what the action sends, the routes that offer it]
const MODERATION = join(STAFF, "moderation");
const CASES: [string, string, string[]][] = [
  [
    "the audited read of a conversation message (approvals)",
    join(MODERATION, "conversation-context.tsx"),
    [join(MODERATION, "approvals/[type]/[id]/page.tsx")],
  ],
  [
    "the audited read of a conversation message (reports)",
    join(MODERATION, "conversation-context.tsx"),
    [join(MODERATION, "reports/[id]/page.tsx")],
  ],
  [
    "the member card, opened from any name",
    join(SRC, "components/forum/member-card-action.tsx"),
    pages(STAFF),
  ],
  [
    "who reacted",
    join(SRC, "components/forum/reaction-users-action.tsx"),
    pages(STAFF),
  ],
];

for (const [what, sent, routes] of CASES) {
  test(`every client component ${what} can send is in the list of each staff route that offers it`, () => {
    const needed = clientModules(sent);
    expect(needed.size).toBeGreaterThan(0);
    const missing: string[] = [];
    for (const page of routes) {
      const list = routeList(page);
      for (const client of needed)
        if (!list.has(client))
          missing.push(`${name(page)} lacks ${name(client)}`);
    }
    expect(missing).toEqual([]);
  });
}

test("the walk sees a gap: a route that imports nothing lacks what an action sends", () => {
  const needed = clientModules(
    join(SRC, "components/forum/member-card-action.tsx"),
  );
  const bare = clientModules(join(SRC, "lib/utils.ts"));
  expect(
    [...needed].filter((client) => !bare.has(client)).length,
  ).toBeGreaterThan(0);
});
