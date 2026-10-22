import { SUPPORTED_LANGUAGES } from "@sermo/core/contracts";

// The interface languages are the ones a member can choose (the backend's list). The locale is
// the hidden first segment of every route (`app/[locale]`) and appears in no address a visitor
// sees: the proxy picks it per visitor and rewrites to it.
export const LOCALES = SUPPORTED_LANGUAGES;
export type Locale = (typeof LOCALES)[number];
// What a visitor picks to follow their browser's language (then the site's) instead of a language.
export const SYSTEM_LANGUAGE = "system";
export const DEFAULT_LOCALE: Locale = "en";

export function isLocale(value: unknown): value is Locale {
  return LOCALES.includes(value as Locale);
}

// The first supported primary subtag of an `Accept-Language` value, in order of preference
// (q, then position). A q that is empty or not a number counts as 0, which is a refusal, and one
// above 1 counts as 1. `_` separates subtags like `-`. Undefined when none is supported.
export function fromAcceptLanguage(header: string | null | undefined) {
  if (!header) return undefined;
  const ranked = header
    .split(",")
    .map((part, position) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params
        .map((param) => /^\s*q\s*=(.*)$/i.exec(param)?.[1])
        .find((value) => value !== undefined);
      const parsed =
        q === undefined ? 1 : Number(q.trim() === "" ? Number.NaN : q);
      return {
        primary: tag.trim().split(/[-_]/)[0]?.toLowerCase() ?? "",
        weight: Number.isNaN(parsed) ? 0 : Math.min(parsed, 1),
        position,
      };
    })
    .filter((entry) => entry.weight > 0 && isLocale(entry.primary))
    .sort((a, b) => b.weight - a.weight || a.position - b.position);
  return ranked[0]?.primary as Locale | undefined;
}

// The locale of a visitor: their cookie when it names a supported language, else their browser's
// language, else the site's default when it is a supported language, else English.
export function negotiateLocale(
  cookie: string | null | undefined,
  acceptLanguage: string | null | undefined,
  siteDefault?: string | null,
): Locale {
  if (isLocale(cookie)) return cookie;
  return (
    fromAcceptLanguage(acceptLanguage) ??
    (isLocale(siteDefault) ? siteDefault : DEFAULT_LOCALE)
  );
}
