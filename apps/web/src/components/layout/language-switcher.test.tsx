import { afterAll, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { messagesFor } from "@/i18n/messages";

// The language the page is drawn in, as the route's root parameter gives it.
let locale = "en";
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => locale,
  getTranslations: async (namespace: string) => {
    const zone = (await messagesFor(locale as "en")) as unknown as Record<
      string,
      Record<string, Record<string, string>>
    >;
    const [file, part] = namespace.split(".");
    return (key: string) => zone[file][part][key];
  },
}));
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

const { LanguageSwitcher } = await import("./language-switcher");

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

async function drawn(current: string) {
  locale = current;
  return renderToStaticMarkup(await LanguageSwitcher());
}

test("every language is offered in its own name and marked with its own language, in either page language", async () => {
  for (const current of ["en", "es"]) {
    const options = tags(await drawn(current), "button").map(
      ({ attributes, text }) => ({
        name: text,
        lang: attributes.lang,
        value: attributes.value,
      }),
    );
    expect(options).toEqual([
      { name: "English", lang: "en", value: "en" },
      { name: "Español", lang: "es", value: "es" },
    ]);
  }
});

test("the group is labelled in the page's language and the current language is marked", async () => {
  for (const [current, label] of [
    ["en", "Language"],
    ["es", "Idioma"],
  ]) {
    const html = await drawn(current);
    expect(tags(html, "fieldset")[0].attributes["aria-label"]).toBe(label);
    const marked = tags(html, "button").filter(
      ({ attributes }) => attributes["aria-current"] === "true",
    );
    expect(marked.map(({ attributes }) => attributes.lang)).toEqual([current]);
  }
});

test("a plain form posts the choice to the language route, so it works before any script runs", async () => {
  const html = await drawn("en");
  const [form] = tags(html, "form");
  expect(form.attributes.method).toBe("post");
  expect(form.attributes.action).toBe("/language");
  for (const { attributes } of tags(html, "button")) {
    expect(attributes.type).toBe("submit");
    expect(attributes.name).toBe("language");
  }
});
