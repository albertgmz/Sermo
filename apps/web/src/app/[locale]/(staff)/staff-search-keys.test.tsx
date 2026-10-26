import { afterAll, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import type { SearchEntry } from "./search-match";

// The keyboard flow of the search's box. The web tests have no DOM, so the keys are read through
// `keyAction` (what the box's key handler does with them) and the markup the box is drawn with.

const nextIntl = { ...(await import("next-intl")) };
const useIntl = await import("use-intl");
mock.module("next-intl", () => ({
  ...nextIntl,
  useLocale: () => "en",
  useTranslations: useIntl.useTranslations,
}));
afterAll(() => {
  mock.module("next-intl", () => nextIntl);
});

const { Dialog } = await import("@/components/ui/dialog");
const { afterPick, keyAction, noteFor, SearchPanel } = await import(
  "./staff-search-popup"
);
const { searchEntries } = await import("./search-match");
const { INPUT_ID } = await import("./staff-search");

const entry = (label: string, href: string, id = ""): SearchEntry => ({
  kind: "setting",
  label,
  help: "",
  id,
  path: ["Setup"],
  href,
});

const ENTRIES = [
  entry("Turnstile forms", "/admin/settings/antispam?setting=turnstileForms"),
  entry("Turnstile", "/admin/settings/antispam?setting=turnstileEnabled"),
  entry(
    "Site key",
    "/admin/settings/antispam?setting=turnstileSiteKey",
    "turnstileSiteKey",
  ),
];
const hits = searchEntries(ENTRIES, "turnstile");
const key = (name: string, isComposing = false) => ({ key: name, isComposing });

test("Enter opens the highlighted result, which is the best match until the arrows move", () => {
  expect(hits.map((hit) => hit.entry.label)).toEqual([
    "Turnstile",
    "Turnstile forms",
    "Site key",
  ]);
  expect(keyAction(key("Enter"), 0, hits)).toEqual({
    open: "/admin/settings/antispam?setting=turnstileEnabled",
  });
  expect(keyAction(key("Enter"), 2, hits)).toEqual({
    open: "/admin/settings/antispam?setting=turnstileSiteKey",
  });
});

test("the arrows move the highlight, round from the last result to the first and back", () => {
  expect(keyAction(key("ArrowDown"), 0, hits)).toEqual({ move: 1 });
  expect(keyAction(key("ArrowDown"), 2, hits)).toEqual({ move: 0 });
  expect(keyAction(key("ArrowUp"), 0, hits)).toEqual({ move: 2 });
  expect(keyAction(key("ArrowUp"), 1, hits)).toEqual({ move: 0 });
});

test("Escape, other keys, a key ending a composed word and keys with no results are left alone", () => {
  // Escape is the dialog's: it closes the search.
  expect(keyAction(key("Escape"), 0, hits)).toBeNull();
  expect(keyAction(key("a"), 0, hits)).toBeNull();
  expect(keyAction(key("Enter", true), 0, hits)).toBeNull();
  expect(keyAction(key("Enter"), 0, [])).toBeNull();
  expect(keyAction(key("ArrowDown"), 0, [])).toBeNull();
});

test("the box names its list and the highlighted result, the best match first", () => {
  const html = renderToStaticMarkup(
    withIntl(
      <Dialog open>
        <SearchPanel
          loaded={ENTRIES}
          query="turnstile"
          onQuery={() => {}}
          onOpen={() => {}}
        />
      </Dialog>,
    ),
  );
  const input = /<input[^>]*>/.exec(html)?.[0] ?? "";
  expect(input).toContain(`id="${INPUT_ID}"`);
  expect(input).toContain('role="combobox"');
  expect(input).toContain('aria-autocomplete="list"');
  const list = /aria-controls="([^"]+)"/.exec(input)?.[1];
  expect(html).toContain(`id="${list}" role="listbox"`);
  const active = /aria-activedescendant="([^"]+)"/.exec(input)?.[1];
  const options = html.match(/<div [^>]*role="option"[^>]*>/g) ?? [];
  expect(options).toHaveLength(3);
  expect(options[0]).toContain(`id="${active}"`);
  expect(options[0]).toContain('aria-selected="true"');
  expect(options[0]).toContain("data-highlighted");
  for (const option of options.slice(1))
    expect(option).toContain('aria-selected="false"');
});

test("the words under the box follow the index and the query", () => {
  expect(noteFor("failed", "turn", 0)).toEqual({ key: "failed" });
  expect(noteFor("loading", "", 0)).toEqual({ key: "hint" });
  expect(noteFor("loading", "turn", 0)).toEqual({ key: "loading" });
  expect(noteFor(ENTRIES, "  ", 0)).toEqual({ key: "hint" });
  expect(noteFor(ENTRIES, " zzz ", 0)).toEqual({ key: "empty", query: "zzz" });
  expect(noteFor(ENTRIES, "turn", 2)).toBeNull();
});

test("a result for the address already shown reveals its row there instead of opening it again", () => {
  const here = {
    pathname: "/admin/settings/antispam",
    search: "?setting=turnstileEnabled",
  };
  expect(
    afterPick("/admin/settings/antispam?setting=turnstileEnabled", here),
  ).toEqual({ navigate: false, reveal: "?setting=turnstileEnabled" });
  // Another row of the same screen, another screen, a screen with no row.
  expect(
    afterPick("/admin/settings/antispam?setting=turnstileSiteKey", here),
  ).toEqual({ navigate: true, reveal: null });
  expect(
    afterPick("/admin/permissions/forums?permission=forum.view", here),
  ).toEqual({ navigate: true, reveal: null });
  expect(
    afterPick("/admin/settings/antispam", { ...here, search: "" }),
  ).toEqual({ navigate: false, reveal: null });
});

test("the Enter that ends a composed word in Safari (key code 229) does not open a result", () => {
  expect(
    keyAction({ key: "Enter", isComposing: false, keyCode: 229 }, 0, hits),
  ).toBeNull();
});

test("the box says its list is open only while it shows results", () => {
  const box = (query: string) =>
    /<input[^>]*>/.exec(
      renderToStaticMarkup(
        withIntl(
          <Dialog open>
            <SearchPanel
              loaded={ENTRIES}
              query={query}
              onQuery={() => {}}
              onOpen={() => {}}
            />
          </Dialog>,
        ),
      ),
    )?.[0] ?? "";
  expect(box("turnstile")).toContain('aria-expanded="true"');
  expect(box("")).toContain('aria-expanded="false"');
  expect(box("zzzz")).toContain('aria-expanded="false"');
});

test("a search that failed or is loading is announced", () => {
  const status = (loaded: "failed" | "loading") =>
    /role="status"[^>]*>([^<]*)</.exec(
      renderToStaticMarkup(
        withIntl(
          <Dialog open>
            <SearchPanel
              loaded={loaded}
              query="turn"
              onQuery={() => {}}
              onOpen={() => {}}
            />
          </Dialog>,
        ),
      ),
    )?.[1] ?? "";
  expect(status("failed")).not.toBe("");
  expect(status("loading")).not.toBe("");
});
