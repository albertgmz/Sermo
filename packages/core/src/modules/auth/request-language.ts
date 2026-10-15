import { SUPPORTED_LANGUAGES } from "../../contracts/settings";

/**
 * The language a visitor reads in, from the request that made their account: the `forum_locale`
 * cookie the web app sets, else the first supported language of `Accept-Language`. Null when the
 * request names none, so the site's default applies.
 */
export function requestLanguage(headers: Headers | undefined): string | null {
  if (!headers) return null;
  const supported = (code: string | undefined) =>
    SUPPORTED_LANGUAGES.find((language) => language === code?.toLowerCase().split("-")[0]) ?? null;
  const cookie = /(?:^|;\s*)forum_locale=([a-zA-Z-]{2,10})(?:;|$)/.exec(
    headers.get("cookie") ?? "",
  );
  const chosen = supported(cookie?.[1]);
  if (chosen) return chosen;
  for (const part of (headers.get("accept-language") ?? "").split(",")) {
    const found = supported(part.split(";")[0]?.trim());
    if (found) return found;
  }
  return null;
}
