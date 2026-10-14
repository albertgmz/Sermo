import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const SRC = resolve(import.meta.dir, "../..");
const ROOTS = ["postbit.tsx", "member-actions.tsx", "member-card.tsx"].map(
  (file) => resolve(import.meta.dir, file),
);

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

// The client modules a server render of the card can reference: the walk stops at each one.
function clientModules() {
  const seen = new Set<string>();
  const found = new Set<string>();
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    if (/^\s*["']use client["']/.test(source)) {
      found.add(file);
      return;
    }
    for (const match of source.matchAll(
      /^(?:import|export)\s(?!type\s)[^;]*?from\s+["']([^"']+)["']/gm,
    )) {
      const next = target(match[1], file);
      if (next) walk(next);
    }
  };
  for (const root of ROOTS) walk(root);
  return found;
}

test("the card parts list holds every client module the card can reference", () => {
  const listed = new Set(
    [
      ...readFileSync(
        resolve(import.meta.dir, "member-card-parts.ts"),
        "utf8",
      ).matchAll(/from\s+["']([^"']+)["']/g),
    ]
      .map((match) => target(match[1], resolve(SRC, "x")))
      .filter(Boolean),
  );
  const missing = [...clientModules()].filter((file) => !listed.has(file));
  expect(missing.map((file) => file.slice(SRC.length))).toEqual([]);
});

test("the root layout imports the list", () => {
  expect(readFileSync(resolve(SRC, "app/layout.tsx"), "utf8")).toContain(
    'import "@/components/forum/member-card-parts"',
  );
});
