import { CookieConsentRoot } from "@/components/layout/cookie-consent-root";
import { LOCALES } from "@/i18n/locales";
import type { ConsentTexts } from "@/lib/consent/config";
import { isCookielessMatomo } from "@/lib/consent/state";
import { bannerApplies } from "@/lib/sermo/banner";
import { forwardFromRequest } from "@/lib/sermo/client";
import { getSite } from "@/lib/sermo/site";

// The cookie banner for every page (public, sign-in and staff). While the site shows the banner to
// everyone (the default) it reads no cookie and no header, so the shell stays prerendered and the
// library decides in the browser whether to show it. A site that asks in Europe only has the
// backend say whether this visitor is asked, which reads the request. The words of every language
// go along, so a change of language does not need a new page.
export async function CookieBanner({ locale }: { locale: string }) {
  const site = await getSite();
  const [entries, shown] = await Promise.all([
    Promise.all(
      LOCALES.map(async (code) => {
        const loaded = await import(`../../../messages/${code}/cookies.json`);
        return [code, loaded.default.banner as ConsentTexts] as const;
      }),
    ),
    site.cookieBannerOutsideEu
      ? true
      : forwardFromRequest().then(bannerApplies),
  ]);
  return (
    <CookieConsentRoot
      texts={Object.fromEntries(entries)}
      locale={locale}
      version={site.cookiePolicyVersion}
      quiet={!shown}
      omit={
        isCookielessMatomo(site.analytics, site.matomoCookieless)
          ? ["analytics"]
          : []
      }
    />
  );
}
