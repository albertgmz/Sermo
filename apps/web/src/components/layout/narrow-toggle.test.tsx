import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import { NarrowToggle } from "./narrow-toggle";
import { readNarrow, widthScript, writeNarrow } from "./narrow-width";

const store = new Map<string, string>();
const attributes = new Map<string, string>();
const globals = globalThis as Record<string, unknown>;

beforeAll(() => {
  globals.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  };
  globals.document = {
    documentElement: {
      setAttribute: (name: string, value: string) =>
        attributes.set(name, value),
      removeAttribute: (name: string) => attributes.delete(name),
    },
  };
});

afterAll(() => {
  delete globals.localStorage;
  delete globals.document;
});

beforeEach(() => {
  store.clear();
  attributes.clear();
});

test("the page is wide until the visitor chooses", () => {
  expect(readNarrow()).toBe(false);
  const html = renderToStaticMarkup(withIntl(<NarrowToggle />));
  expect(html).toContain('aria-pressed="false"');
  // Another suite may have stubbed the translator to return keys.
  expect(html).toMatch(/aria-label="(narrow|Use a narrower page)"/);
  expect(html).toContain("min-[1100px]:inline-flex");
  expect(attributes.size).toBe(0);
});

test("choosing narrow stores it and sets the attribute, choosing wide clears both", () => {
  writeNarrow(true);
  expect(store.get("sermo-width")).toBe("narrow");
  expect(attributes.get("data-width")).toBe("narrow");
  expect(readNarrow()).toBe(true);

  writeNarrow(false);
  expect(store.has("sermo-width")).toBe(false);
  expect(attributes.has("data-width")).toBe(false);
  expect(readNarrow()).toBe(false);
});

test("a stored choice is read back and the head script applies it", () => {
  store.set("sermo-width", "narrow");
  expect(readNarrow()).toBe(true);
  new Function(widthScript)();
  expect(attributes.get("data-width")).toBe("narrow");
});

test("blocked storage reads as wide and does not throw on write", () => {
  globals.localStorage = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  expect(readNarrow()).toBe(false);
  writeNarrow(true);
  expect(attributes.get("data-width")).toBe("narrow");
  expect(() => new Function(widthScript)()).not.toThrow();
});
