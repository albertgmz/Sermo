import { CookieConsentRoot } from "@/components/layout/cookie-consent-root";
import { LOCALES } from "@/i18n/locales";
import type { ConsentTexts } from "@/lib/consent/config";
import { policyVersion } from "@/lib/consent/state";
import { getSite } from "@/lib/sermo/site";

// The cookie banner for every page (public, sign-in and staff). It reads no cookie, so the shell
// stays prerendered; the library decides in the browser whether to show it. The words of every
// language go along, so a change of language does not need a new page.
export async function CookieBanner({ locale }: { locale: string }) {
  const [site, entries] = await Promise.all([
    getSite(),
    Promise.all(
      LOCALES.map(async (code) => {
        const loaded = await import(`../../../messages/${code}/cookies.json`);
        return [code, loaded.default.banner as ConsentTexts] as const;
      }),
    ),
  ]);
  return (
    <CookieConsentRoot
      texts={Object.fromEntries(entries)}
      locale={locale}
      version={policyVersion(site)}
    />
  );
}
