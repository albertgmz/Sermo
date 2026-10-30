import { SUPPORTED_LANGUAGES } from "@sermo/core/contracts";

// The interface languages are the ones a member can choose (the backend's list). The locale is
// the hidden first segment of every route (`app/[locale]`) and appears in no address a visitor
// sees: the proxy picks it per visitor and rewrites to it.
export const LOCALES = SUPPORTED_LANGUAGES;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "es";

export function isLocale(value: unknown): value is Locale {
  return LOCALES.includes(value as Locale);
}

// The locale of a visitor: their cookie when it names a supported language (they chose it with the
// language switch), else the site's default when it is a supported language, else Spanish. The
// browser's `Accept-Language` does not pick the language.
export function negotiateLocale(
  cookie: string | null | undefined,
  siteDefault?: string | null,
): Locale {
  if (isLocale(cookie)) return cookie;
  return isLocale(siteDefault) ? siteDefault : DEFAULT_LOCALE;
}
