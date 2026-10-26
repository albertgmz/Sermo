import { afterAll, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

const nextIntl = { ...(await import("next-intl")) };
const useIntl = await import("use-intl");
mock.module("next-intl", () => ({
  ...nextIntl,
  useTranslations: useIntl.useTranslations,
}));
afterAll(() => {
  mock.module("next-intl", () => nextIntl);
});

const { isSearchShortcut, shortcutStep, StaffSearch, TRIGGER_ID } =
  await import("./staff-search");

const press = (key: string, more: Partial<KeyboardEvent> = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  isComposing: false,
  defaultPrevented: false,
  ...more,
});

test("Ctrl+K opens the search, and ⌘K on a Mac", () => {
  expect(isSearchShortcut(press("k", { ctrlKey: true }), false)).toBe(true);
  // Caps Lock on.
  expect(isSearchShortcut(press("K", { ctrlKey: true }), false)).toBe(true);
  expect(isSearchShortcut(press("k", { metaKey: true }), true)).toBe(true);
  expect(isSearchShortcut(press("k", { ctrlKey: true }), true)).toBe(true);
  // The Windows key is not Ctrl.
  expect(isSearchShortcut(press("k", { metaKey: true }), false)).toBe(false);
});

test("Ctrl+K opens a closed search and puts the focus back in an open one's box", () => {
  const ctrlK = press("k", { ctrlKey: true });
  expect(shortcutStep(ctrlK, false, false)).toBe("open");
  expect(shortcutStep(ctrlK, true, false)).toBe("focus");
  expect(shortcutStep(press("k"), true, false)).toBeNull();
  expect(shortcutStep(press("k"), false, false)).toBeNull();
});

test("K alone, with Alt or Shift, while composing a word or already used does not open it", () => {
  expect(isSearchShortcut(press("k"), false)).toBe(false);
  expect(
    isSearchShortcut(press("k", { ctrlKey: true, altKey: true }), false),
  ).toBe(false);
  expect(
    isSearchShortcut(press("k", { ctrlKey: true, shiftKey: true }), false),
  ).toBe(false);
  expect(
    isSearchShortcut(press("k", { ctrlKey: true, isComposing: true }), false),
  ).toBe(false);
  expect(
    isSearchShortcut(
      press("k", { ctrlKey: true, defaultPrevented: true }),
      false,
    ),
  ).toBe(false);
  expect(isSearchShortcut(press("j", { ctrlKey: true }), false)).toBe(false);
});

test("the box is a plain button naming the search and its keys, with no field until it is opened", () => {
  const html = renderToStaticMarkup(withIntl(<StaffSearch />));
  expect(html).toContain(`id="${TRIGGER_ID}"`);
  expect(html).toContain('type="button"');
  expect(html).toContain('aria-haspopup="dialog"');
  expect(html).toContain('aria-keyshortcuts="Control+K Meta+K"');
  // Its words are read out on a phone too, where only the icon shows.
  expect(html).toContain("Search the panel");
  expect(html).toContain("sr-only sm:not-sr-only");
  expect(html).toContain("Ctrl+K");
  expect(html).not.toContain("<input");
});

// The dialog, the matching, the index's action and Base UI's list come when the box is reached
// for: only the box names the popup, and only through `import(`.
test("the search's code is loaded with its popup, not with the panel", () => {
  const source = readFileSync(
    join(import.meta.dir, "staff-search.tsx"),
    "utf8",
  );
  expect(source).toMatch(/import\("\.\/staff-search-popup"\)/);
  for (const lazy of [
    "staff-search-popup",
    "search-match",
    "search-action",
    "@base-ui/react/autocomplete",
  ])
    expect(source).not.toMatch(new RegExp(`^import[^;]*${lazy}`, "m"));
  const layout = readFileSync(join(import.meta.dir, "layout.tsx"), "utf8");
  expect(layout).not.toMatch(/staff-search-popup|search-match|search-action/);
});
