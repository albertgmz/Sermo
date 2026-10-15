import type { Analytics } from "@sermo/core/contracts";
import type * as z from "zod";

type Provider = z.output<typeof Analytics>;
type Snippet = { id: string; src?: string; code?: string };

// A value placed in a script is always a JSON literal; `<` is escaped so a value can never close
// the script element.
const literal = (value: unknown) =>
  JSON.stringify(value).replace(/</g, String.raw`\u003c`);

// The scripts a provider needs, in the order they run; none for `none`.
export function analyticsSnippets(
  analytics: Provider,
  options: { cookieless?: boolean } = {},
): Snippet[] {
  if (analytics.provider === "matomo") {
    const base = analytics.url.endsWith("/")
      ? analytics.url
      : `${analytics.url}/`;
    return [
      {
        id: "analytics-matomo",
        code:
          "var _paq=window._paq=window._paq||[];" +
          // Before the first page view, so no cookie is ever set.
          (options.cookieless ? "_paq.push(['disableCookies']);" : "") +
          `_paq.push(['setTrackerUrl',${literal(`${base}matomo.php`)}]);` +
          `_paq.push(['setSiteId',${literal(analytics.siteId)}]);` +
          // The address and title of this page as it is now: the library may arrive after a
          // navigation, and would otherwise record the page it finds then.
          "_paq.push(['setCustomUrl',location.href]);" +
          "_paq.push(['setDocumentTitle',document.title]);" +
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

type Paq = unknown[][];

// What Matomo is told about page views after the first one (the snippet reports that one): a
// client navigation changes the address and the title without loading the page again.
export function pageViewReporter(paq: Paq) {
  let first = true;
  return (href: string, title: string) => {
    if (first) {
      first = false;
      return;
    }
    paq.push(["setCustomUrl", href]);
    paq.push(["setDocumentTitle", title]);
    paq.push(["trackPageView"]);
  };
}
