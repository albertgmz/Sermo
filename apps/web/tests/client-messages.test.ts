import { expect, test } from "bun:test";
import {
  CLIENT_NAMESPACES,
  pickClientMessages,
} from "../src/i18n/client-messages";
import { messages } from "../src/i18n/messages";
import { clientModules, namespacesIn } from "./client-namespaces";

// Calls whose namespace is a variable: what the variable can be.
const VARIABLE_NAMESPACES: Record<string, string[]> = {
  "src/components/staff/run-now.tsx": [
    "adminEconomy.awards",
    "adminGroups.promotions",
  ],
};

// The component namespace (`zone.component`) of every `useTranslations` call a client reads.
function used() {
  const found = new Map<string, string>();
  for (const [file, source] of clientModules()) {
    const name = file.replaceAll("\\", "/").replace(/^.*[/]apps[/]web[/]/, "");
    for (const namespace of namespacesIn(source)) {
      const options =
        namespace === null ? VARIABLE_NAMESPACES[name] : [namespace];
      if (!options)
        throw new Error(
          `${name} calls useTranslations with a variable: list its namespaces in VARIABLE_NAMESPACES`,
        );
      for (const option of options) {
        const [zone, component] = option.split(".");
        found.set(component ? `${zone}.${component}` : zone, name);
      }
    }
  }
  return found;
}

test("the browser is given every namespace a client component reads", () => {
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

test("only the listed namespaces are picked, whole", () => {
  const picked = pickClientMessages(messages) as Record<
    string,
    Record<string, unknown>
  >;
  expect(picked.layout.userMenu).toEqual(messages.layout.userMenu);
  expect(picked.layout.siteFooter).toBeUndefined();
  expect(picked.adminUsers).toBeDefined();
  expect(picked.moderation.queues).toBeUndefined();
  expect(Object.keys(picked.layout).length).toBeLessThan(
    Object.keys(messages.layout).length,
  );
});
