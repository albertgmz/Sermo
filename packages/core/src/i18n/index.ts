import IntlMessageFormat from "intl-messageformat";
import en from "./locales/en.json";
import es from "./locales/es.json";

export type Language = "en" | "es";
const catalogs: Record<Language, Record<string, string>> = { en, es };
const compiled = new Map<string, IntlMessageFormat>();

export function languageFor(memberLanguage: string | null, defaultLanguage: string): Language {
  const language = (memberLanguage ?? defaultLanguage).split("-")[0];
  return language === "es" ? "es" : "en";
}

export function phrase(
  language: Language,
  key: string,
  values: Record<string, string | number> = {},
): string {
  const message = catalogs[language][key] ?? catalogs.en[key];
  if (!message) throw new Error(`Missing phrase: ${key}`);
  const cacheKey = `${language}:${key}`;
  let format = compiled.get(cacheKey);
  if (!format) {
    format = new IntlMessageFormat(message, language);
    compiled.set(cacheKey, format);
  }
  return String(format.format(values));
}

export function phraseOr(
  language: Language,
  key: string,
  fallback: string,
  values: Record<string, string | number> = {},
): string {
  return catalogs[language][key] || catalogs.en[key] ? phrase(language, key, values) : fallback;
}
