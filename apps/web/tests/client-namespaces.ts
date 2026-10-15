import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { walk } from "./lite-scan";

// Which interface text the browser needs: the namespaces that client components read. A client
// component is a "use client" module and everything it imports (dynamic imports too: a lazy popup
// is client code), so a plain helper that calls `useTranslations` for a client component counts.

const SRC = resolve(import.meta.dirname, "../src");

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

function specifiers(source: string) {
  const found: string[] = [];
  const patterns = [
    /^\s*(?:import|export)\s(?!type\s)[^;]*?\sfrom\s+["']([^"']+)["']/gm,
    /^\s*import\s+["']([^"']+)["']/gm,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns)
    for (const match of source.matchAll(pattern)) found.push(match[1]);
  return found;
}

const isClient = (source: string) => /^\s*["']use client["']/m.test(source);
const isServerAction = (source: string) =>
  /^\s*["']use server["']/m.test(source);

// The source of every module a client component can load, by path.
export function clientModules(): Map<string, string> {
  const files = walk("src")
    .filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path))
    .map((path) => resolve(SRC, "..", path));
  const sources = new Map(
    files.map((file) => [file, readFileSync(file, "utf8")] as const),
  );
  const reached = new Map<string, string>();
  const visit = (file: string) => {
    const source = sources.get(file) ?? readFileSync(file, "utf8");
    if (reached.has(file) || isServerAction(source)) return;
    reached.set(file, source);
    for (const spec of specifiers(source)) {
      const next = target(spec, file);
      if (next) visit(next);
    }
  };
  for (const [file, source] of sources) if (isClient(source)) visit(file);
  return reached;
}

// The namespaces a module reads with `useTranslations`: the string it names, the fixed start of a
// template, and `null` for a call whose argument is a variable.
export function namespacesIn(source: string): (string | null)[] {
  return [
    ...source.matchAll(/\buseTranslations\(\s*(?:"([^"]+)"|`([^`$]*)|(\w+))?/g),
  ].map((match) => match[1] ?? match[2] ?? (match[3] ? null : ""));
}
