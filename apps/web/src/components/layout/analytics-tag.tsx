import Script from "next/script";
import { getConsent } from "@/lib/consent/server";
import { analyticsFor } from "@/lib/consent/state";
import { getSite } from "@/lib/sermo/site";
import { MatomoPageViews } from "./matomo-page-views";

// The site's analytics tag for the public pages, only for a visitor who accepted analytics. The
// staff panel is a different layout and never renders this.
export async function AnalyticsTag() {
  const [{ analytics }, consent] = await Promise.all([getSite(), getConsent()]);
  const snippets = analyticsFor(consent, analytics);
  if (snippets.length === 0) return null;
  return (
    <>
      {snippets.map(({ id, src, code }) =>
        src ? (
          <Script key={id} id={id} src={src} strategy="afterInteractive" />
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
