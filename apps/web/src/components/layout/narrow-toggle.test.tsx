import { afterAll, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

// The button reads its words through the library's hook and the provider of `withIntl`, whatever
// stand-in another suite left in place for it.
const nextIntl = await import("next-intl");
const useIntl = await import("use-intl");
mock.module("next-intl", () => ({
  ...nextIntl,
  useLocale: () => "en",
  useTranslations: useIntl.useTranslations,
}));

const { NarrowButton, NarrowToggle } = await import("./narrow-toggle");
const {
  isNarrow,
  restoreNarrow,
  setNarrow,
  subscribeNarrow,
  toggleNarrow,
  widthScript,
} = await import("./narrow-width");

type StorageEvent = { key: string | null };

const store = new Map<string, string>();
const attributes = new Map<string, string>();
const windowListeners = new Map<string, (event: StorageEvent) => void>();
const globals = globalThis as Record<string, unknown>;

function useWorkingStorage() {
  globals.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  };
}

function useBlockedStorage() {
  const blocked = () => {
    throw new Error("blocked");
  };
  globals.localStorage = {
    getItem: blocked,
    setItem: blocked,
    removeItem: blocked,
  };
}

beforeAll(() => {
  globals.document = {
    documentElement: {
      getAttribute: (name: string) => attributes.get(name) ?? null,
      setAttribute: (name: string, value: string) =>
        attributes.set(name, value),
      removeAttribute: (name: string) => attributes.delete(name),
    },
  };
  globals.window = {
    addEventListener: (type: string, listener: (event: StorageEvent) => void) =>
      windowListeners.set(type, listener),
    removeEventListener: (type: string) => windowListeners.delete(type),
  };
});

afterAll(() => {
  delete globals.localStorage;
  delete globals.document;
  delete globals.window;
});

beforeEach(() => {
  store.clear();
  attributes.clear();
  windowListeners.clear();
  useWorkingStorage();
});

function draw(narrow: boolean) {
  return renderToStaticMarkup(
    withIntl(<NarrowButton narrow={narrow} onToggle={() => {}} />),
  );
}

test("the page is wide until the visitor chooses", () => {
  expect(isNarrow()).toBe(false);
  const html = renderToStaticMarkup(withIntl(<NarrowToggle />));
  expect(html).toContain('aria-pressed="false"');
  expect(html).toMatch(/<button[^>]*>.*Use a narrower page<\/span><\/button>/);
  expect(html).toContain("min-[1100px]:inline-flex");
  expect(attributes.size).toBe(0);
});

test("a narrow page draws a pressed button with the same label", () => {
  const html = draw(true);
  expect(html).toContain('aria-pressed="true"');
  expect(html).toContain("Use a narrower page</span>");
});

test("a click stores the choice and sets the attribute, a second click clears both", () => {
  toggleNarrow();
  expect(store.get("sermo-width")).toBe("narrow");
  expect(attributes.get("data-width")).toBe("narrow");
  expect(isNarrow()).toBe(true);

  toggleNarrow();
  expect(store.has("sermo-width")).toBe(false);
  expect(attributes.has("data-width")).toBe(false);
  expect(isNarrow()).toBe(false);
});

test("the head script applies a stored choice and the button restores it", () => {
  store.set("sermo-width", "narrow");
  new Function(widthScript)();
  expect(attributes.get("data-width")).toBe("narrow");
  attributes.clear();
  restoreNarrow();
  expect(isNarrow()).toBe(true);
});

test("with storage blocked the button still goes narrow and back", () => {
  useBlockedStorage();
  expect(() => new Function(widthScript)()).not.toThrow();
  toggleNarrow();
  expect(isNarrow()).toBe(true);
  expect(draw(isNarrow())).toContain('aria-pressed="true"');
  toggleNarrow();
  expect(isNarrow()).toBe(false);
  expect(draw(isNarrow())).toContain('aria-pressed="false"');
});

test("another tab's choice is applied to this page and announced", () => {
  let heard = 0;
  const unsubscribe = subscribeNarrow(() => {
    heard += 1;
  });
  const onStorage = windowListeners.get("storage");
  expect(onStorage).toBeDefined();

  setNarrow(true);
  expect(heard).toBe(1);
  // The other tab went wide: its storage change reaches this tab.
  store.delete("sermo-width");
  onStorage?.({ key: "sermo-width" });
  expect(isNarrow()).toBe(false);
  expect(heard).toBe(2);

  store.set("sermo-width", "narrow");
  onStorage?.({ key: "sermo-width" });
  expect(isNarrow()).toBe(true);
  expect(heard).toBe(3);

  onStorage?.({ key: "something-else" });
  expect(heard).toBe(3);

  unsubscribe();
  expect(windowListeners.has("storage")).toBe(false);
});
