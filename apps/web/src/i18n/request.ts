import { cookies, headers } from "next/headers";
import { locale as rootLocale } from "next/root-params";
import { getRequestConfig } from "next-intl/server";
import { LOCALE_COOKIE } from "@/i18n/locale-cookie";
import { isLocale, negotiateLocale } from "@/i18n/locales";
import { messagesFor } from "@/i18n/messages";

// Root parameters exist only while a page renders. A Server Action or a Route Handler that asks
// for interface text has no route, so its locale is the visitor's own (cookie, then browser).
const NO_ROUTE = /inside a (Server Action|Route Handler)/;

async function currentLocale() {
  try {
    const fromRoute = await rootLocale();
    if (isLocale(fromRoute)) return fromRoute;
  } catch (error) {
    if (!(error instanceof Error) || !NO_ROUTE.test(error.message)) throw error;
  }
  const [store, requestHeaders] = await Promise.all([cookies(), headers()]);
  return negotiateLocale(
    store.get(LOCALE_COOKIE)?.value,
    requestHeaders.get("accept-language"),
  );
}

// A page takes its locale from the route (`app/[locale]`) and reads no cookie or header here:
// that is what keeps the shell prerendered, one per language. Do not add `now`: reading the clock
// here would run during prerendering.
export default getRequestConfig(async () => {
  const locale = await currentLocale();
  return { locale, messages: await messagesFor(locale), timeZone: "UTC" };
});
