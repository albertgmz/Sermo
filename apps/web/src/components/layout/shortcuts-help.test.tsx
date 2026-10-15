import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import en from "../../../messages/en/layout.json";
import es from "../../../messages/es/layout.json";

// The list reads its words through the library's hook and the provider of `withIntl`, whatever
// stand-in another suite left in place for it.
const nextIntl = await import("next-intl");
const useIntl = await import("use-intl");
mock.module("next-intl", () => ({
  ...nextIntl,
  useLocale: () => "en",
  useTranslations: useIntl.useTranslations,
}));

const { ShortcutsList } = await import("./shortcuts-help");
const { GROUPS, SHORTCUTS } = await import("./shortcuts");

const markup = renderToStaticMarkup(withIntl(<ShortcutsList />));
const text = (html: string) =>
  html.replace(/<[^>]*>/g, "|").replace(/\|+/g, "|");

test("the help lists every shortcut with its words and its keys", () => {
  for (const shortcut of SHORTCUTS) {
    const label = en.shortcuts.actions[shortcut.id];
    expect(markup).toContain(`>${label}<`);
    for (const key of shortcut.keys) {
      expect(markup).toContain(`>${key}</kbd>`);
    }
  }
});

test("the help names the keys the brief asks for", () => {
  const caps = [...markup.matchAll(/<kbd[^>]*>([^<]*)<\/kbd>/g)].map(
    (match) => match[1],
  );
  for (const key of [
    "?",
    "/",
    "j",
    "k",
    "r",
    "c",
    "g",
    "h",
    "n",
    "Esc",
    "Ctrl",
    "\\",
  ]) {
    expect(caps).toContain(key);
  }
});

test("a sequence reads key, then, key; a combination reads key plus key", () => {
  const flat = text(markup);
  expect(flat).toContain("|g|then|h|");
  expect(flat).toContain("|Ctrl|+|\\|");
});

test("the shortcuts are grouped under headings", () => {
  for (const group of GROUPS) {
    expect(markup).toContain(`>${en.shortcuts.groups[group]}</h3>`);
  }
});

test("every shortcut and group has its words in Spanish, written out", () => {
  for (const shortcut of SHORTCUTS) {
    const spanish = es.shortcuts.actions[shortcut.id];
    expect(spanish.length).toBeGreaterThan(0);
    expect(Object.keys(es.shortcuts.actions)).toContain(shortcut.id);
  }
  for (const group of GROUPS) {
    expect(es.shortcuts.groups[group].length).toBeGreaterThan(0);
  }
  expect(Object.keys(es.shortcuts.actions).sort()).toEqual(
    SHORTCUTS.map((shortcut) => shortcut.id).sort(),
  );
  expect(Object.keys(en.shortcuts.actions).sort()).toEqual(
    SHORTCUTS.map((shortcut) => shortcut.id).sort(),
  );
});
