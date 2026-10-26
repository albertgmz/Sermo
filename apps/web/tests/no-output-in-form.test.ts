import { expect, setDefaultTimeout, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// These tests are slow only when the full suite shares the machine (disk and CPU): the 5 s default is too short.
setDefaultTimeout(30_000);

// A form owns every `<output>` inside it. After a form action React 19 calls `form.reset()`, and
// that resets each owned `<output>` to its default value. Firefox does it by replacing the
// children of the `<output>`, so React then removes a node that is no longer there and the route
// shows its error page (`NotFoundError: Node.removeChild`). A live region inside a form is
// `<p role="status" aria-live="polite">` (or a `<span>`), which no form owns.
//
// A file that renders a form (`<form` or a component named `...Form`) must not contain `<output`.
// An entry here is a file whose `<output>` sits outside every form.
const OUTSIDE_FORM: Record<string, string> = {
  "app/[locale]/(main)/ui/settings-demo.tsx":
    "The `<output>` after the avatar row is a sibling of the demo forms, not a child of one.",
};

const FORM = /<(?:form|[A-Z][A-Za-z]*Form)\b/;
const OUTPUT = /<output\b/;

const root = new URL("../src", import.meta.url).pathname.replace(
  /^\/(?=[a-z]:)/i,
  "",
);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)
      ? [path]
      : [];
  });
}

test("no file that renders a form contains an <output> element", () => {
  const base = decodeURIComponent(root);
  const found: string[] = [];
  for (const file of sources(base)) {
    const name = relative(base, file).split("\\").join("/");
    if (name in OUTSIDE_FORM) continue;
    const text = readFileSync(file, "utf8");
    if (FORM.test(text) && OUTPUT.test(text)) found.push(name);
  }
  expect(found).toEqual([]);
});

test("every OUTSIDE_FORM entry still contains an <output> element", () => {
  const base = decodeURIComponent(root);
  const stale = Object.keys(OUTSIDE_FORM).filter(
    (name) => !OUTPUT.test(readFileSync(join(base, name), "utf8")),
  );
  expect(stale).toEqual([]);
});
