import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { walk } from "./lite-scan";

const root = import.meta.dir.replace(/tests$/, "");
const dir = "src/app/[locale]/(main)/conversations/[id]";
const source = (path: string) => readFileSync(`${root}${path}`, "utf8");

// The leave step (radios, confirming button, the action) and the mark-unread action are code for
// a press: the conversation page's first load carries only their buttons. Nothing else may name
// the step, and the buttons name the code through `dynamic(` and `import(` alone.
test("the leave step and the mark-unread action are loaded on a press", () => {
  const holders = walk("src")
    .filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path))
    .filter((path) => /from\s+["'][^"']*leave-step["']/.test(source(path)));
  expect(holders).toEqual([]);
  const leave = source(`${dir}/leave-form.tsx`);
  expect(leave).toMatch(/dynamic\(\s*\(\)\s*=>\s*import\([\s\S]*?leave-step/);
  expect(leave).not.toMatch(/^import[^;]*(leave-step|delete-control|actions)/m);
  const unread = source(`${dir}/mark-unread-form.tsx`);
  expect(unread).toMatch(/await import\(\s*"[^"]*conversations\/actions"/);
  expect(unread).not.toMatch(/^import[^;]*conversations\/actions/m);
});

// The recipient picker of "Add people" is code for a press as well.
test("the add-people form is loaded on a press", () => {
  const holders = walk("src")
    .filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path))
    .filter((path) =>
      /from\s+["'][^"']*add-people-form["']/.test(source(path)),
    );
  expect(holders).toEqual([]);
  const button = source(`${dir}/add-people.tsx`);
  expect(button).toMatch(/dynamic\(\s*\(\)\s*=>\s*import\(/);
  expect(button).not.toMatch(/^import[^;]*(add-people-form|recipient-picker)/m);
});
