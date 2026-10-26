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
  if (analytics.provider === "google") {
    const id = analytics.measurementId;
    return [
      {
        id: "analytics-google-js",
        // Through Cloudflare's Google tag gateway the gateway's path serves the tag of its
        // measurement id (Google's guide: `<script async src="/metrics/">`); otherwise Google does.
        src: analytics.tagPath
          ? `${analytics.tagPath}/`
          : `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`,
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
