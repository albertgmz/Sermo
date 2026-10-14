import Script from "next/script";
import { getSite } from "@/lib/sermo/site";
import { analyticsSnippets } from "./analytics-snippets";
import { MatomoPageViews } from "./matomo-page-views";

// The site's analytics tag for the public pages. The staff panel is a different layout and never
// renders this.
export async function AnalyticsTag() {
  const { analytics } = await getSite();
  if (analytics.provider === "none") return null;
  return (
    <>
      {analyticsSnippets(analytics).map(({ id, src, code }) =>
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
