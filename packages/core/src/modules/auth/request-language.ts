import { SUPPORTED_LANGUAGES } from "../../contracts/settings";

/**
 * The language a visitor chose, from the request that made their account: the `forum_locale`
 * cookie the web app sets. Null when the request has none, so the site's default applies. The
 * browser's `Accept-Language` does not choose a language.
 */
export function requestLanguage(headers: Headers | undefined): string | null {
  if (!headers) return null;
  const cookie = /(?:^|;\s*)forum_locale=([a-zA-Z-]{2,10})(?:;|$)/.exec(
    headers.get("cookie") ?? "",
  );
  const code = cookie?.[1]?.toLowerCase().split("-")[0];
  return SUPPORTED_LANGUAGES.find((language) => language === code) ?? null;
}
