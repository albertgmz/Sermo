import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  CLIENT_NAMESPACES,
  pickClientMessages,
  ROOT_NAMESPACES,
} from "../src/i18n/client-messages";
import { messages } from "../src/i18n/messages";
import {
  clientModules,
  componentNamespaces,
  namespacesReachedFrom,
} from "./client-namespaces";
import { walk } from "./lite-scan";

// The component namespace (`zone.component`) of every `useTranslations` call a client reads.
function used() {
  const found = new Map<string, string>();
  for (const [file, source] of clientModules()) {
    const name = file.replaceAll("\\", "/").replace(/^.*[/]apps[/]web[/]/, "");
    for (const namespace of componentNamespaces(file, source))
      found.set(namespace, name);
  }
  return found;
}

test("every namespace a client component reads is listed", () => {
  const missing = [...used()].filter(
    ([namespace]) =>
      !(CLIENT_NAMESPACES as readonly string[]).includes(namespace),
  );
  expect(missing.map(([namespace, file]) => `${namespace} (${file})`)).toEqual(
    [],
  );
});

test("and no namespace that none of them reads", () => {
  const read = used();
  expect(CLIENT_NAMESPACES.filter((namespace) => !read.has(namespace))).toEqual(
    [],
  );
});

test("every listed namespace exists in the catalogue", () => {
  for (const namespace of CLIENT_NAMESPACES) {
    const [zone, component] = namespace.split(".");
    const found = (messages as Record<string, Record<string, unknown>>)[zone]?.[
      component
    ];
    expect(found, namespace).toBeDefined();
  }
});

test("only the given namespaces are picked, whole", () => {
  const picked = pickClientMessages(messages, [
    "layout.userMenu",
    "forum.poll",
  ]) as Record<string, Record<string, unknown>>;
  expect(picked.layout.userMenu).toEqual(messages.layout.userMenu);
  expect(Object.keys(picked.layout)).toEqual(["userMenu"]);
  expect(picked.forum.poll).toEqual(messages.forum.poll);
  expect(picked.adminUsers).toBeUndefined();
  expect(picked.moderation).toBeUndefined();
});

// The providers: the root layout sends ROOT_NAMESPACES; a layout adds the namespaces in its
// `<ClientMessages namespaces={[...]}>`, for itself and everything under it.
const SCREENS =
  /^src\/app\/\[locale\]\/(?:.*\/)?(page|layout|loading|error|not-found|template|default)\.tsx$/;
const screens = walk("src/app").filter((path) => SCREENS.test(path));
const layouts = screens.filter((path) => path.endsWith("/layout.tsx"));

function declared(path: string): string[] {
  const source = readFileSync(resolve(import.meta.dirname, "..", path), "utf8");
  const list = source.match(/<ClientMessages\s+namespaces=\{\[([^\]]*)\]\}/);
  return list ? [...list[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [];
}

const inside = (path: string, folder: string) =>
  dirname(path) === folder || dirname(path).startsWith(`${folder}/`);

function provided(path: string): Set<string> {
  const found = new Set<string>(ROOT_NAMESPACES);
  for (const layout of layouts)
    if (inside(path, dirname(layout)))
      for (const n of declared(layout)) found.add(n);
  return found;
}

const needs = new Map(
  screens.map((path) => [
    path,
    namespacesReachedFrom(resolve(import.meta.dirname, "..", path)),
  ]),
);

test("only layouts send interface text", () => {
  const others = screens.filter(
    (path) => !path.endsWith("/layout.tsx") && declared(path).length > 0,
  );
  expect(others).toEqual([]);
});

test("every client component under a page is given the text it reads", () => {
  const missing: string[] = [];
  for (const [path, namespaces] of needs) {
    const have = provided(path);
    for (const namespace of namespaces)
      if (!have.has(namespace)) missing.push(`${namespace} (${path})`);
  }
  expect(missing).toEqual([]);
});

test("a layout sends only what something under it reads, and nothing twice", () => {
  const problems: string[] = [];
  for (const layout of layouts) {
    const folder = dirname(layout);
    const under = screens.filter((path) => inside(path, folder));
    const above = new Set<string>(ROOT_NAMESPACES);
    for (const other of layouts)
      if (other !== layout && inside(layout, dirname(other)))
        for (const n of declared(other)) above.add(n);
    for (const namespace of declared(layout)) {
      if (!under.some((path) => needs.get(path)?.has(namespace)))
        problems.push(`${namespace} is read by nothing under ${layout}`);
      if (above.has(namespace))
        problems.push(`${namespace} in ${layout} is already sent above it`);
    }
  }
  expect(problems).toEqual([]);
});
