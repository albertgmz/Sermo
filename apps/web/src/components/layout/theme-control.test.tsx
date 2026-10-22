import { afterAll, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

const nextIntl = await import("next-intl");
const useIntl = await import("use-intl");
mock.module("next-intl", () => ({
  ...nextIntl,
  useLocale: () => "en",
  useTranslations: useIntl.useTranslations,
}));

const saved: string[] = [];
mock.module("./theme-actions", () => ({
  saveTheme: async (theme: string) => {
    saved.push(theme);
    return { ok: true };
  },
}));

const { ThemeChoices, ThemeControl, chooseTheme } = await import(
  "./theme-control"
);
const { currentTheme, setTheme, subscribeTheme, themeScript } = await import(
  "./theme"
);

type Listener = (event: { key?: string | null }) => void;

const store = new Map<string, string>();
const attributes = new Map<string, string>();
const classes = new Set<string>();
const windowListeners = new Map<string, Set<Listener>>();
const mediaListeners = new Set<() => void>();
// The <head> the script writes the bar's colour into: what it put first, in order.
type Meta = { name: string; content: string };
const marked = new WeakSet<object>();
class FakeMeta {
  name = "";
  content = "";
  setAttribute() {
    marked.add(this);
  }
}
const head: Meta[] = [];
let deviceDark = true;
let legacyMedia = false;
const globals = globalThis as Record<string, unknown>;

function emit(type: string, event: { key?: string | null } = {}) {
  for (const listener of windowListeners.get(type) ?? []) listener(event);
}

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

function addListener(type: string, listener: Listener) {
  const set = windowListeners.get(type) ?? new Set();
  set.add(listener);
  windowListeners.set(type, set);
}

beforeAll(() => {
  globals.document = {
    documentElement: {
      getAttribute: (name: string) => attributes.get(name) ?? null,
      setAttribute: (name: string, value: string) =>
        attributes.set(name, value),
      classList: {
        toggle: (name: string, on: boolean) =>
          on ? classes.add(name) : classes.delete(name),
      },
    },
    head: { prepend: (meta: Meta) => head.unshift(meta) },
    createElement: () => new FakeMeta(),
    querySelector: (selector: string) =>
      selector === 'meta[name="theme-color"][data-theme-bar]'
        ? (head.find((meta) => marked.has(meta)) ?? null)
        : selector === 'meta[name="theme-color"]:not([media])'
          ? (head.find((meta) => meta.name === "theme-color") ?? null)
          : null,
  };
  globals.matchMedia = () => ({
    addListener: (listener: () => void) => mediaListeners.add(listener),
    get matches() {
      return deviceDark;
    },
    addEventListener: legacyMedia
      ? undefined
      : (_type: string, listener: () => void) => mediaListeners.add(listener),
  });
  globals.addEventListener = addListener;
  globals.window = {
    addEventListener: addListener,
    removeEventListener: (type: string, listener: Listener) =>
      windowListeners.get(type)?.delete(listener),
    dispatchEvent: (event: { type: string }) => {
      emit(event.type);
      return true;
    },
  };
  globals.Event = class {
    constructor(readonly type: string) {}
  };
});

afterAll(() => {
  for (const name of [
    "localStorage",
    "document",
    "matchMedia",
    "addEventListener",
    "window",
    "Event",
  ]) {
    delete globals[name];
  }
});

beforeEach(() => {
  store.clear();
  attributes.clear();
  classes.clear();
  windowListeners.clear();
  mediaListeners.clear();
  head.length = 0;
  deviceDark = true;
  legacyMedia = false;
  useWorkingStorage();
});

function run() {
  new Function(themeScript)();
}

const theme = () => attributes.get("data-theme");

test("with no choice the page is light before first paint, whatever the device", () => {
  run();
  expect(theme()).toBe("light");
  expect(classes.has("dark")).toBe(false);
  expect(attributes.get("data-theme-choice")).toBe("light");
  expect(currentTheme()).toBe("light");
  // A value this version does not know is no choice either.
  store.set("sermo-theme", "blue");
  emit("storage", { key: "sermo-theme" });
  expect(theme()).toBe("light");
});

test("System follows the device before first paint and when it changes", () => {
  store.set("sermo-theme", "system");
  run();
  expect(theme()).toBe("dark");
  expect(classes.has("dark")).toBe(true);
  deviceDark = false;
  for (const listener of mediaListeners) listener();
  expect(theme()).toBe("light");
  expect(classes.has("dark")).toBe(false);
});

test("the browser bar takes the colour of the theme shown", () => {
  run();
  expect(head).toEqual([{ name: "theme-color", content: "#fafafa" }]);
  setTheme("dark");
  expect(head).toEqual([{ name: "theme-color", content: "#151521" }]);
  setTheme("system");
  expect(head).toEqual([{ name: "theme-color", content: "#151521" }]);
  deviceDark = false;
  for (const listener of mediaListeners) listener();
  expect(head).toEqual([{ name: "theme-color", content: "#fafafa" }]);
  setTheme("light");
  expect(head).toEqual([{ name: "theme-color", content: "#fafafa" }]);
});

test("a browser with only the old media listener call is followed too", () => {
  store.set("sermo-theme", "system");
  legacyMedia = true;
  run();
  deviceDark = false;
  for (const listener of mediaListeners) listener();
  expect(theme()).toBe("light");
});

test("the page listeners are in place before the device query is read", () => {
  let registered = 0;
  const original = globals.matchMedia;
  globals.matchMedia = () => {
    registered = windowListeners.get("sermo-theme")?.size ?? 0;
    return { matches: true, addEventListener: () => {} };
  };
  run();
  globals.matchMedia = original;
  expect(registered).toBe(1);
});

test("a stored choice beats the default and the device", () => {
  store.set("sermo-theme", "dark");
  deviceDark = false;
  run();
  expect(theme()).toBe("dark");
  expect(classes.has("dark")).toBe(true);
  store.set("sermo-theme", "light");
  deviceDark = true;
  emit("storage", { key: "sermo-theme" });
  expect(theme()).toBe("light");
  expect(classes.has("dark")).toBe(false);
});

test("choosing applies at once and keeps the choice, System included", () => {
  run();
  setTheme("dark");
  expect(theme()).toBe("dark");
  expect(store.get("sermo-theme")).toBe("dark");
  expect(currentTheme()).toBe("dark");
  setTheme("system");
  expect(store.get("sermo-theme")).toBe("system");
  expect(currentTheme()).toBe("system");
  expect(theme()).toBe("dark");
  setTheme("light");
  expect(store.get("sermo-theme")).toBe("light");
  expect(theme()).toBe("light");
});

test("with storage blocked the page is light and the choice still switches it", () => {
  useBlockedStorage();
  expect(run).not.toThrow();
  expect(theme()).toBe("light");
  setTheme("dark");
  expect(theme()).toBe("dark");
  expect(currentTheme()).toBe("dark");
});

test("another tab's choice is applied and announced here", () => {
  run();
  let heard = 0;
  subscribeTheme(() => {
    heard += 1;
  });
  store.set("sermo-theme", "light");
  emit("storage", { key: "sermo-theme" });
  expect(theme()).toBe("light");
  expect(heard).toBe(1);
});

test("the group has three buttons and marks the chosen one", () => {
  const html = renderToStaticMarkup(
    withIntl(<ThemeChoices value="light" onChange={() => {}} />),
  );
  expect(html).toContain("<fieldset");
  expect(html.match(/<button/g)).toHaveLength(3);
  expect(html).toContain('aria-label="Light" title="Light"');
  expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
});

test("labelled draws the words and the control starts on Light", () => {
  const html = renderToStaticMarkup(withIntl(<ThemeControl labelled />));
  expect(html).toContain(">System<");
  expect(html).toContain(">Dark<");
  expect(html).toMatch(/aria-pressed="true"[^>]*>(?:(?!<button).)*Light/);
});

test("the bar's colour is a meta of the script's own, ahead of the layout's, which is left alone", () => {
  const layouts = { name: "theme-color", content: "#fafafa" };
  head.push(layouts);
  store.set("sermo-theme", "dark");
  run();
  expect(head).toEqual([
    { name: "theme-color", content: "#151521" },
    { name: "theme-color", content: "#fafafa" },
  ]);
  expect(head[1]).toBe(layouts);
});

test("the account's cookie wins over what this browser kept, so a member's page starts in their theme", () => {
  store.set("sermo-theme", "light");
  (globals.document as { cookie?: string }).cookie =
    "a=b; sermo-account-theme=dark; c=d";
  run();
  expect(theme()).toBe("dark");
  expect(attributes.get("data-theme-choice")).toBe("dark");
  // A cookie value this version does not know falls back to the browser's own choice.
  (globals.document as { cookie?: string }).cookie = "sermo-account-theme=blue";
  run();
  expect(attributes.get("data-theme-choice")).toBe("light");
  store.set("sermo-theme", "system");
  run();
  expect(attributes.get("data-theme-choice")).toBe("system");
  (globals.document as { cookie?: string }).cookie = "";
});

test("choosing a theme applies it here and asks the server to keep it", () => {
  saved.length = 0;
  chooseTheme("dark");
  expect(theme()).toBeUndefined();
  expect(currentTheme()).toBe("dark");
  expect(store.get("sermo-theme")).toBe("dark");
  expect(saved).toEqual(["dark"]);
});
