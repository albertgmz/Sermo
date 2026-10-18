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

type Tag = { attributes: Record<string, string>; text: string };

// Each `<name ...>` of the markup: its attributes, and the text up to the next tag.
function tags(html: string, name: string): Tag[] {
  return [...html.matchAll(new RegExp(`<${name}\\b([^>]*)>([^<]*)`, "g"))].map(
    ([, attributes, text]) => ({
      attributes: Object.fromEntries(
        [...attributes.matchAll(/([\w-]+)="([^"]*)"/g)].map(
          ([, key, value]) => [key, value],
        ),
      ),
      text,
    }),
  );
}

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

// Every option, the current one included, in order: its name, its language and what it posts.
const options = (html: string) =>
  [...html.matchAll(/<(button|span)\b([^>]*)>([^<]*)<\/\1>/g)].map(
    ([, element, attributes, name]) => {
      const attribute = (key: string) =>
        new RegExp(`\\b${key}="([^"]*)"`).exec(attributes)?.[1] ?? null;
      return {
        element,
        name,
        lang: attribute("lang"),
        value: attribute("value"),
        current: attribute("aria-current"),
      };
    },
  );

test("every language is offered in its own name and marked with its own language, in either page language", async () => {
  for (const locale of ["en", "es"] as const) {
    expect(
      options(await drawn(locale)).map(({ name, lang }) => ({ name, lang })),
    ).toEqual([
      { name: "English", lang: "en" },
      { name: "Español", lang: "es" },
    ]);
  }
});

test("the group is labelled in the page's language; the current language is marked and is no button, the others post their code", async () => {
  for (const [locale, label, other] of [
    ["en", "Language", "es"],
    ["es", "Idioma", "en"],
  ] as const) {
    const html = await drawn(locale);
    expect(tags(html, "fieldset")[0].attributes["aria-label"]).toBe(label);
    const drawnOptions = options(html);
    expect(drawnOptions.find(({ lang }) => lang === locale)).toMatchObject({
      element: "span",
      current: "true",
      value: null,
    });
    expect(drawnOptions.find(({ lang }) => lang === other)).toMatchObject({
      element: "button",
      current: null,
      value: other,
    });
  }
});

test("a plain form posts the choice to the language route, so it works before any script runs", async () => {
  const html = await drawn("en");
  const [form] = tags(html, "form");
  expect(form.attributes.method).toBe("post");
  expect(form.attributes.action).toBe("/language");
  // The route sends the browser back to this id.
  expect(form.attributes.id).toBe(LANGUAGE_SWITCHER_ID);
  for (const { attributes } of tags(html, "button")) {
    expect(attributes.type).toBe("submit");
    expect(attributes.name).toBe("language");
  }
});
