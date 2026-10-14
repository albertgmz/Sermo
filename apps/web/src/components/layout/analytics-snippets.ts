import type { Analytics } from "@sermo/core/contracts";
import type * as z from "zod";

type Provider = z.output<typeof Analytics>;
type Snippet = { id: string; src?: string; code?: string };

// A value placed in a script is always a JSON literal; `<` is escaped so a value can never close
// the script element.
const literal = (value: unknown) =>
  JSON.stringify(value).replace(/</g, String.raw`\u003c`);

// The scripts a provider needs, in the order they run; none for `none`.
export function analyticsSnippets(analytics: Provider): Snippet[] {
  if (analytics.provider === "matomo") {
    const base = analytics.url.endsWith("/")
      ? analytics.url
      : `${analytics.url}/`;
    return [
      {
        id: "analytics-matomo",
        code:
          "var _paq=window._paq=window._paq||[];" +
          `_paq.push(['setTrackerUrl',${literal(`${base}matomo.php`)}]);` +
          `_paq.push(['setSiteId',${literal(analytics.siteId)}]);` +
          "_paq.push(['trackPageView']);_paq.push(['enableLinkTracking']);",
      },
      { id: "analytics-matomo-js", src: `${base}matomo.js` },
    ];
  }
  if (analytics.provider === "google") {
    const id = analytics.measurementId;
    return [
      {
        id: "analytics-google-js",
        src: `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`,
      },
      {
        id: "analytics-google",
        code:
          "window.dataLayer=window.dataLayer||[];" +
          "function gtag(){dataLayer.push(arguments);}" +
          `gtag('js',new Date());gtag('config',${literal(id)});`,
      },
    ];
  }
  return [];
}
// The styleguide sits among the public pages and carries no tag; `path` is the path the proxy
// handed to the page (absent on a client-side render).
export function carriesAnalytics(path: string | null) {
  return !(path === "/ui" || /^\/ui[/?]/.test(path ?? ""));
}
