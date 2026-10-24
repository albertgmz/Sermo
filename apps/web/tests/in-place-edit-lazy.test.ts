import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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
  expect(source(`${dir}/edit-thread-button.tsx`)).toContain(
    'import("@/app/[locale]/(main)/threads/[id]/edit-thread-popup")',
  );
  expect(holdersOf("prefix-select-popup")).toEqual([]);
});
