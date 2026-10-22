// The visitor's language choice, kept in a cookie the proxy reads to pick the locale. Readable by
// scripts on purpose: `LocaleSync` compares it with the member's saved language before writing.
export const LOCALE_COOKIE = "forum_locale";

export const LOCALE_COOKIE_OPTIONS = {
  httpOnly: false,
  sameSite: "lax",
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
} as const;

// The value of the locale cookie in a `cookie` header or `document.cookie` string.
export function localeCookieValue(cookieHeader: string) {
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === LOCALE_COOKIE) return rest.join("=");
  }
  return undefined;
}

// What a visitor picks to follow their browser's language (then the site's) instead of a language.
// Here, not in `locales.ts`, which pulls the backend contracts into any client module that reads it.
export const SYSTEM_LANGUAGE = "system";
