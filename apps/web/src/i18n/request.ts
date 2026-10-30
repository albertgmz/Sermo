import { cookies } from "next/headers";
import { locale as rootLocale } from "next/root-params";
import { getRequestConfig } from "next-intl/server";
import { LOCALE_COOKIE } from "@/i18n/locale-cookie";
import { isLocale, negotiateLocale } from "@/i18n/locales";
import { messagesFor } from "@/i18n/messages";
import { siteDefaultLanguage } from "@/lib/sermo/default-language";

// Root parameters exist only while a page renders. A Server Action or a Route Handler that asks
// for interface text has no route, so its locale is the visitor's own: cookie, then the site's
// default.
const NO_ROUTE = /inside a (Server Action|Route Handler)/;

async function currentLocale() {
  try {
    const fromRoute = await rootLocale();
    if (isLocale(fromRoute)) return fromRoute;
  } catch (error) {
    if (!(error instanceof Error) || !NO_ROUTE.test(error.message)) throw error;
  }
  const cookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  // The site's default is asked for only when the cookie names no supported language. It is not
  // `getSite()`: that one asks for interface text, which asks for the locale, which is this.
  return negotiateLocale(
    cookie,
    isLocale(cookie) ? undefined : await siteDefaultLanguage(),
  );
}

// A page takes its locale from the route (`app/[locale]`) and reads no cookie or header here:
// that is what keeps the shell prerendered, one per language. Do not add `now`: reading the clock
// here would run during prerendering.
export default getRequestConfig(async () => {
  const locale = await currentLocale();
  return { locale, messages: await messagesFor(locale), timeZone: "UTC" };
});
