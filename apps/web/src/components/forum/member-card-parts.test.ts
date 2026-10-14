import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const SRC = resolve(import.meta.dir, "../..");
const ACTION = resolve(import.meta.dir, "member-card-action.tsx");
const PARTS = resolve(import.meta.dir, "member-card-parts.ts");

function target(spec: string, from: string) {
  const base = spec.startsWith("@/")
    ? resolve(SRC, spec.slice(2))
    : spec.startsWith(".")
      ? resolve(dirname(from), spec)
      : null;
  if (!base) return null;
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
    for (const match of source.matchAll(pattern)) found.push(match[1]);
  return found;
}

// The client modules a server render of the card can reference, found from the action that
// renders it. The walk stops at each client module, and does not go through the parts list itself
// (it would find everything it imports).
function clientModules() {
  const seen = new Set<string>();
  const found = new Set<string>();
  const walk = (file: string) => {
    if (seen.has(file) || file === PARTS) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    if (/^\s*["']use client["']/.test(source)) {
      found.add(file);
      return;
    }
    for (const spec of specifiers(source)) {
      const next = target(spec, file);
      if (next) walk(next);
    }
  };
  // The action file itself is "use server": what it renders is what its imports draw.
  for (const spec of specifiers(readFileSync(ACTION, "utf8"))) {
    const next = target(spec, ACTION);
    if (next) walk(next);
  }
  return found;
}

function parts() {
  const source = readFileSync(PARTS, "utf8");
  const imports = [
    ...source.matchAll(/^import\s+\{([^}]*)\}\s+from\s+["']([^"']+)["']/gm),
  ].map((match) => ({
    names: match[1]
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
    file: target(match[2], PARTS),
  }));
  const array = /Object\.freeze\(\[([^\]]*)\]\)/.exec(source)?.[1] ?? "";
  const listed = array
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return { imports, listed };
}

test("the parts list imports every client module the card can reference", () => {
  const imported = new Set(parts().imports.map((entry) => entry.file));
  const missing = [...clientModules()].filter((file) => !imported.has(file));
  expect(missing.map((file) => file.slice(SRC.length))).toEqual([]);
});

test("everything the parts list imports is in its array, so the import is used", () => {
  const { imports, listed } = parts();
  const unused = imports
    .flatMap((entry) => entry.names)
    .filter((name) => !listed.includes(name));
  expect(unused).toEqual([]);
  expect(listed.length).toBeGreaterThan(0);
});

test("the walk finds the modules it is meant to", () => {
  const names = [...clientModules()].map((file) =>
    file.slice(SRC.length).replaceAll("\\", "/"),
  );
  expect(names).toContain("/components/forum/member-follow-button.tsx");
  expect(names).toContain("/components/ui/progress.tsx");
});

test("the server modules that render a card trigger import the list", () => {
  for (const file of ["user-link.tsx", "user-avatar.tsx", "html-content.tsx"]) {
    const source = readFileSync(resolve(import.meta.dir, file), "utf8");
    expect(specifiers(source)).toContain(
      "@/components/forum/member-card-parts",
    );
  }
});
