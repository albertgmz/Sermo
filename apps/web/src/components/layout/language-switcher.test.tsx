import { afterAll, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { messagesFor } from "@/i18n/messages";

// The page's language. Other suites replace `useLocale` with an English stand-in, and Bun keeps
// module mocks for the whole run, so this one names the language of the page being drawn.
let pageLocale = "en";
const intl = await import("next-intl");
mock.module("next-intl", () => ({ ...intl, useLocale: () => pageLocale }));
afterAll(() => {
  mock.module("next-intl", () => intl);
});

const { LANGUAGE_SWITCHER_ID, LanguageSwitcher } = await import(
  "./language-switcher"
);

// The switcher on a page drawn in `locale`, with that language's messages.
async function drawn(locale: "en" | "es") {
  pageLocale = locale;
  return renderToStaticMarkup(
    <IntlProvider
      locale={locale}
      messages={await messagesFor(locale)}
      timeZone="UTC"
    >
      <LanguageSwitcher />
    </IntlProvider>,
  );
}

// Every option in order: its value, its name and its language.
const options = (html: string) =>
  [...html.matchAll(/<option\b([^>]*)>([^<]*)<\/option>/g)].map(
    ([, attributes, name]) => {
      const attribute = (key: string) =>
        new RegExp(`\\b${key}="([^"]*)"`).exec(attributes)?.[1] ?? null;
      return {
        value: attribute("value"),
        name,
        lang: attribute("lang"),
        selected: / selected/.test(attributes),
      };
    },
  );

test("System comes first, then each language in its own name and marked with it, in either page language", async () => {
  for (const [locale, system] of [
    ["en", "Automatic (site language)"],
    ["es", "Automático (idioma del sitio)"],
  ] as const) {
    expect(
      options(await drawn(locale)).map(({ value, name, lang }) => ({
        value,
        name,
        lang,
      })),
    ).toEqual([
      { value: "system", name: system, lang: null },
      { value: "en", name: "English", lang: "en" },
      { value: "es", name: "Español", lang: "es" },
    ]);
  }
});

test("with no language cookie the dropdown shows System, labelled in the page's language", async () => {
  for (const [locale, label] of [
    ["en", "Language"],
    ["es", "Idioma"],
  ] as const) {
    const html = await drawn(locale);
    expect(html).toContain(`aria-label="${label}"`);
    expect(
      options(html)
        .filter(({ selected }) => selected)
        .map(({ value }) => value),
    ).toEqual(["system"]);
  }
});

test("a plain form posts the choice to the language route, so it works before any script runs", async () => {
  const html = await drawn("en");
  expect(html).toMatch(/<form\b[^>]*method="post"/);
  expect(html).toMatch(/<form\b[^>]*action="\/language"/);
  // The route sends the browser back to this id.
  expect(html).toContain(`id="${LANGUAGE_SWITCHER_ID}"`);
  expect(html).toContain('<select aria-label="Language" name="language"');
  expect(html).toMatch(/<noscript><button type="submit"[^>]*>Apply<\/button>/);
});
