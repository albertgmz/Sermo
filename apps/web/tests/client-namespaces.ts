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

// Calls whose namespace is a variable: what the variable can be.
const VARIABLE_NAMESPACES: Record<string, string[]> = {
  "src/components/staff/run-now.tsx": [
    "adminEconomy.awards",
    "adminGroups.promotions",
  ],
};

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

// The component namespace (`zone.component`) of every `useTranslations` call in a module; a call
// with a variable takes its namespaces from VARIABLE_NAMESPACES.
export function componentNamespaces(file: string, source: string): string[] {
  const name = file.replaceAll("\\", "/").replace(/^.*[/]apps[/]web[/]/, "");
  const found = new Set<string>();
  for (const namespace of namespacesIn(source)) {
    const options =
      namespace === null ? VARIABLE_NAMESPACES[name] : [namespace];
    if (!options)
      throw new Error(
        `${name} calls useTranslations with a variable: list its namespaces in VARIABLE_NAMESPACES`,
      );
    for (const option of options) {
      const [zone, component] = option.split(".");
      found.add(component ? `${zone}.${component}` : zone);
    }
  }
  return [...found];
}

// The namespaces read by the client modules reachable from one file: a page or layout, the server
// components it imports, and the client components under them.
const sources = new Map<string, string>();
function sourceOf(file: string) {
  let source = sources.get(file);
  if (source === undefined) {
    source = readFileSync(file, "utf8");
    sources.set(file, source);
  }
  return source;
}

export function namespacesReachedFrom(entry: string): Set<string> {
  const found = new Set<string>();
  const seen = new Set<string>();
  const visit = (file: string, inClient: boolean) => {
    const key = `${file}|${inClient}`;
    if (seen.has(key)) return;
    seen.add(key);
    const source = sourceOf(file);
    if (isServerAction(source)) return;
    const client = inClient || isClient(source);
    if (client) for (const n of componentNamespaces(file, source)) found.add(n);
    for (const spec of specifiers(source)) {
      const next = target(spec, file);
      if (next) visit(next, client);
    }
  };
  visit(resolve(entry), false);
  return found;
}
