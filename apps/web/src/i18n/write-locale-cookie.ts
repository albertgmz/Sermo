import "server-only";

import { LOCALE_COOKIE, LOCALE_COOKIE_OPTIONS } from "@/i18n/locale-cookie";
import { secureCookies } from "@/lib/sermo/config";

type Options = typeof LOCALE_COOKIE_OPTIONS & { secure: boolean };

// Writes the visitor's language cookie, to the cookies of an action (`cookies()`) or of a route's
// answer (`response.cookies`): `Secure` when the site is served over https.
export function writeLocaleCookie(
  jar: { set(name: string, value: string, options: Options): unknown },
  language: string,
) {
  jar.set(LOCALE_COOKIE, language, {
    ...LOCALE_COOKIE_OPTIONS,
    secure: secureCookies(),
  });
}
