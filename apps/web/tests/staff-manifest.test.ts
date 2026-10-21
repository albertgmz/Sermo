import { expect, test } from "bun:test";
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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

const MODERATION = join(STAFF, "moderation");
const CONTEXT = join(MODERATION, "conversation-context.tsx");

// The pages that offer an audited read (`AuditedRead`, whose action returns `ConversationContext`):
// found from the code, so a page that moves or a new one is checked too.
const auditedPages = pages(STAFF).filter((page) =>
  /from\s+["'][^"']*\/audited-read["']/.test(readFileSync(page, "utf8")),
);

// [what the action sends, the routes that offer it]
const CASES: [string, string, string[]][] = [
  ["an audited read", CONTEXT, auditedPages],
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

test("the audited reads are found: the approvals page and the reported message page", () => {
  expect(auditedPages.map(name).sort()).toEqual([
    "app/[locale]/(staff)/moderation/approvals/[type]/[id]/page.tsx",
    "app/[locale]/(staff)/moderation/reports/[id]/message/page.tsx",
  ]);
});

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

// The reported message page without the import of the parts list is the gap that answered the
// moderator's "confirm view" with React error #441: the walk must see it.
test("the walk sees the gap when a page does not import the audited read's parts", () => {
  const page = join(MODERATION, "reports/[id]/message/page.tsx");
  const without = join(dirname(page), "page.without-parts.tsx");
  const source = readFileSync(page, "utf8").replace(
    /^import ["'][^"']*conversation-context-parts["'];\n/m,
    "",
  );
  expect(source).not.toContain("conversation-context-parts");
  writeFileSync(without, source);
  try {
    const list = routeList(without);
    const lacking = [...clientModules(CONTEXT)]
      .filter((client) => !list.has(client))
      .map(name)
      .sort();
    expect(lacking).toEqual([
      "components/forum/mention-cards.tsx",
      "components/forum/spoiler-reveal.tsx",
    ]);
  } finally {
    rmSync(without, { force: true });
  }
});
