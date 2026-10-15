import Script from "next/script";
import { getConsent } from "@/lib/consent/server";
import { analyticsFor } from "@/lib/consent/state";
import { getSite } from "@/lib/sermo/site";
import { MatomoPageViews } from "./matomo-page-views";

// The site's analytics tag for the public pages, only for a visitor who accepted analytics (Matomo
// in its cookieless mode, a site setting, needs no choice). The staff panel is a different layout
// and never renders this. The provider's own script, which is the download, waits until the page
// has loaded and the browser is idle; the short inline settings stay where they were, so the
// commands they queue (cookies off, then the first page view) reach the provider in that order.
export async function AnalyticsTag() {
  const [{ analytics, matomoCookieless }, consent] = await Promise.all([
    getSite(),
    getConsent(),
  ]);
  const snippets = analyticsFor(consent, analytics, matomoCookieless);
  if (snippets.length === 0) return null;
  return (
    <>
      {snippets.map(({ id, src, code }) =>
        src ? (
          <Script key={id} id={id} src={src} strategy="lazyOnload" />
        ) : (
          <Script key={id} id={id} strategy="afterInteractive">
            {code}
          </Script>
        ),
      )}
      {analytics.provider === "matomo" && <MatomoPageViews />}
    </>
  );
}
