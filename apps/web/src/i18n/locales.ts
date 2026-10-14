import { SUPPORTED_LANGUAGES } from "@sermo/core/contracts";

// The interface languages are the ones a member can choose (the backend's list). The locale is
// the hidden first segment of every route (`app/[locale]`) and appears in no address a visitor
// sees: the proxy picks it per visitor and rewrites to it.
export const LOCALES = SUPPORTED_LANGUAGES;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export function isLocale(value: unknown): value is Locale {
  return LOCALES.includes(value as Locale);
}

// The first supported primary subtag of an `Accept-Language` value, in order of preference
// (q, then position); a tag with q=0 is a refusal. Undefined when none is supported.
export function fromAcceptLanguage(header: string | null | undefined) {
  if (!header) return undefined;
  const ranked = header
    .split(",")
    .map((part, position) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params
        .map((param) => /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(param)?.[1])
        .find((value) => value !== undefined);
      const weight = q === undefined ? 1 : Number(q);
      return {
        primary: tag.trim().split("-")[0]?.toLowerCase() ?? "",
        weight: Number.isFinite(weight) ? weight : 0,
        position,
      };
    })
    .filter((entry) => entry.weight > 0 && isLocale(entry.primary))
    .sort((a, b) => b.weight - a.weight || a.position - b.position);
  return ranked[0]?.primary as Locale | undefined;
}

// The locale of a visitor: their cookie when it names a supported language, else their browser's
// language, else English.
export function negotiateLocale(
  cookie: string | null | undefined,
  acceptLanguage: string | null | undefined,
): Locale {
  if (isLocale(cookie)) return cookie;
  return fromAcceptLanguage(acceptLanguage) ?? DEFAULT_LOCALE;
}
