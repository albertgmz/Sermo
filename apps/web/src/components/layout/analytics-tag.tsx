import { getConsent } from "@/lib/consent/server";
import { analyticsFor } from "@/lib/consent/state";
import { scriptNonce } from "@/lib/script-nonce";
import { getSite } from "@/lib/sermo/site";
import { AnalyticsScript } from "./analytics-script";

// The site's analytics tag for the public pages, only for a visitor who accepted analytics. The staff panel is a different
// layout and never renders this. The provider's own script, which is the download, waits until
// the page has loaded and the browser is idle.
export async function AnalyticsTag() {
  const [{ analytics }, consent, nonce] = await Promise.all([
    getSite(),
    getConsent(),
    scriptNonce(),
  ]);
  const snippets = analyticsFor(consent, analytics);
  if (snippets.length === 0) return null;
  return (
    <>
      {snippets.map(({ id, src, code }) =>
        src ? (
          <AnalyticsScript
            key={id}
            id={id}
            src={src}
            nonce={nonce}
            strategy="lazyOnload"
          />
        ) : (
          <AnalyticsScript
            key={id}
            id={id}
            nonce={nonce}
            strategy="afterInteractive"
          >
            {code}
          </AnalyticsScript>
        ),
      )}
    </>
  );
}
