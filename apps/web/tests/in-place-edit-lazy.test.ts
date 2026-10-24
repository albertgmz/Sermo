import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { walk } from "./lite-scan";

const root = import.meta.dir.replace(/tests$/, "");
const dir = "src/app/[locale]/(main)/threads/[id]";
const source = (path: string) => readFileSync(`${root}${path}`, "utf8");

// Modules that name `module` with an import that loads it (a type import loads nothing).
const holdersOf = (module: string) =>
  walk("src")
    .filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path))
    .filter((path) =>
      new RegExp(
        `^import (?!type )[^;]*from\\s+["'][^"']*/${module}["']`,
        "m",
      ).test(source(path)),
    );

// The editor of a post edited in place, the thread's edit dialog and the prefix menu are code for
// a press: the thread's first load carries only their buttons, and they name the code through
// `import(` alone.
test("the in-place editors and the prefix menu are loaded when they are reached for", () => {
  expect(holdersOf("inline-post-editor")).toEqual([]);
  expect(source(`${dir}/post-edit-scope.tsx`)).toMatch(
    /const loadEditor = \(\) =>\s*import\("@\/app\/\[locale\]\/\(main\)\/threads\/\[id\]\/inline-post-editor"\)/,
  );
  expect(holdersOf("edit-thread-popup")).toEqual([]);
  expect(source(`${dir}/thread-toolbar.tsx`)).toContain(
    'import("@/app/[locale]/(main)/threads/[id]/edit-thread-popup")',
  );
  expect(holdersOf("prefix-select-popup")).toEqual([]);
});

// The modules a static import chain brings into the first load from `entry` (a "use server"
// module is a reference to the action, not its code), and those of them that import the backend's
// contracts, which carry every schema and zod with them.
function contractHolders(entry: string) {
  const fileOf = (spec: string, from: string) => {
    const base = spec.startsWith("@/")
      ? `${root}src/${spec.slice(2)}`
      : `${from.slice(0, from.lastIndexOf("/"))}/${spec}`;
    return [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find(existsSync);
  };
  const seen = new Set<string>();
  const holders: string[] = [];
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    if (/^\s*["']use server["']/m.test(text)) return;
    for (const [, spec] of text.matchAll(
      /^(?:import|export) (?!type )[^;]*?from "([^"]+)";/gm,
    )) {
      if (spec === "@sermo/core/contracts")
        holders.push(file.slice(root.length));
      const next =
        spec.startsWith("@/") || spec.startsWith(".")
          ? fileOf(spec, file)
          : undefined;
      if (next) visit(next);
    }
  };
  visit(`${root}${entry}`);
  return holders;
}

// The quick edit, the shared reply and the edit page's form are in the first load of every thread
// and conversation page (and of both edit pages): none of them may bring the contracts along.
test("the first load of the shared post and message forms reaches no backend contract", () => {
  for (const entry of [
    `${dir}/post-edit-scope.tsx`,
    `${dir}/reply-composer.tsx`,
    `${dir}/edit/[postId]/edit-post-form.tsx`,
    "src/components/forum/content-actions.tsx",
  ])
    expect(contractHolders(entry), entry).toEqual([]);
});
