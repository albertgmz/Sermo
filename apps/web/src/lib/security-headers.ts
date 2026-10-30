import type { Analytics, SocialProvider } from "@sermo/core/contracts";
import type * as z from "zod";
import { EMBED_HOSTS } from "@/lib/consent/embeds";

type Provider = z.output<typeof Analytics>;

// The request header that hands a page its nonce: the layouts put it on the scripts they draw.
// Next reads the nonce of its own scripts from the policy, which the page is rendered with too.
export const NONCE_HEADER = "x-nonce";

// A fresh value for every response: 128 random bits, base64.
export function newNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

export type PageSecurity = {
  nonce: string;
  // Whether the request reached the app over https: its own scheme, or the one the proxy in front
  // of it reports.
  https: boolean;
  // The origin the browser sees (SERMO_PUBLIC_URL).
  publicUrl: string;
  // The site's analytics provider: its script is let in by the nonce, but what it sends goes to
  // its own address.
  analytics: Provider;
  // The sign-in providers that are on (`site.get` `socialSignIn.providers`).
  signIn: readonly SocialProvider[];
  // `next dev` rebuilds server errors in the browser with `eval`.
  development: boolean;
};

// Cloudflare's widget on the guest forms: its script, and the frame it draws the challenge in.
const TURNSTILE = "https://challenges.cloudflare.com";

// Google's sign-in library (One Tap), as its guide to a Content-Security-Policy lists it: the
// script, the frames it draws the prompt in, its endpoints and its stylesheet.
const GSI = "https://accounts.google.com/gsi/";

// Where each provider's sign-in page is. The sign-in buttons are forms whose answer redirects there,
// and a browser holds that redirect to form-action. X keeps its old id in Better Auth.
const providerOrigin = (provider: SocialProvider) =>
  provider === "google"
    ? "https://accounts.google.com"
    : provider === "github"
      ? "https://github.com"
      : "https://x.com";

const googleSignIn = (security: PageSecurity) =>
  security.signIn.includes("google");

// Where gtag.js sends its measurements, as Google's guide to a Content-Security-Policy lists them.
const GOOGLE_ANALYTICS = [
  "https://*.google-analytics.com",
  "https://*.analytics.google.com",
  "https://*.googletagmanager.com",
];

function analyticsOrigins(analytics: Provider) {
  if (analytics.provider !== "google") return [];
  // The gateway serves the tag from the site's own address, so the tag manager origin goes. Google
  // says only some measurements use the gateway path: the others still go to its own addresses.
  return analytics.tagPath
    ? GOOGLE_ANALYTICS.filter((origin) => !origin.includes("googletagmanager"))
    : GOOGLE_ANALYTICS;
}

// The browser features nothing on the site uses, refused to the page and to every frame in it.
// Fullscreen, picture-in-picture and encrypted media stay as the browser has them: the embedded
// players are given them by their own `allow` attribute.
const DENIED_FEATURES = [
  "accelerometer",
  "camera",
  "display-capture",
  "geolocation",
  "gyroscope",
  "hid",
  "magnetometer",
  "microphone",
  "midi",
  "payment",
  "screen-wake-lock",
  "serial",
  "usb",
  "xr-spatial-tracking",
];

const upgradesRequests = (security: PageSecurity) =>
  security.publicUrl.startsWith("https:");

// The policy of a page. Scripts run only with this response's nonce; 'strict-dynamic' lets them
// load the scripts they need (the page's chunks, the Turnstile widget, an analytics tag), and
// leaves no host list to get around. Styles may be inline: React draws style attributes and
// `<style>` elements without a nonce, and a nonce in the list would turn 'unsafe-inline' off.
// Pictures in posts are linked from any https address, so img-src cannot be narrower.
export function contentSecurityPolicy(security: PageSecurity) {
  const upgrade = upgradesRequests(security);
  const google = googleSignIn(security);
  const directives: [string, ...string[]][] = [
    ["default-src", "'self'"],
    [
      "script-src",
      "'self'",
      `'nonce-${security.nonce}'`,
      "'strict-dynamic'",
      ...(security.development ? ["'unsafe-eval'"] : []),
      ...(google ? [`${GSI}client`] : []),
    ],
    [
      "style-src",
      "'self'",
      "'unsafe-inline'",
      ...(google ? [`${GSI}style`] : []),
    ],
    ["img-src", "'self'", "data:", "https:", ...(upgrade ? [] : ["http:"])],
    ["media-src", "'self'", "https:"],
    ["font-src", "'self'"],
    // The service worker and the manifest are the site's own. Named here because worker-src would
    // otherwise fall back to script-src, where browsers differ on whether 'self' still counts beside
    // 'strict-dynamic'.
    ["worker-src", "'self'"],
    ["manifest-src", "'self'"],
    [
      "connect-src",
      "'self'",
      ...analyticsOrigins(security.analytics),
      ...(google ? [GSI] : []),
    ],
    [
      "frame-src",
      ...EMBED_HOSTS.map((host) => `https://${host}`),
      TURNSTILE,
      ...(google ? [GSI] : []),
    ],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'", ...security.signIn.map(providerOrigin)],
    ["frame-ancestors", "'none'"],
    ...(upgrade ? [["upgrade-insecure-requests"] as [string]] : []),
  ];
  return directives.map((directive) => directive.join(" ")).join("; ");
}

// Every header a page is answered with, the policy among them.
export function securityHeaders(security: PageSecurity): [string, string][] {
  const headers: [string, string][] = [
    ["Content-Security-Policy", contentSecurityPolicy(security)],
    ["X-Content-Type-Options", "nosniff"],
    ["X-Frame-Options", "DENY"],
    ["Referrer-Policy", "strict-origin-when-cross-origin"],
    [
      "Permissions-Policy",
      DENIED_FEATURES.map((feature) => `${feature}=()`).join(", "),
    ],
    // Google's library opens a popup where the browser has no FedCM (Safari, Firefox), and its guide
    // asks for this value then: the page keeps the popups it opens, and a page that opens this one
    // still gets no handle on it.
    [
      "Cross-Origin-Opener-Policy",
      googleSignIn(security) ? "same-origin-allow-popups" : "same-origin",
    ],
  ];
  // Sent when the request came over https or the site's address is https; a browser ignores it on
  // an http response.
  if (security.https || upgradesRequests(security))
    headers.push([
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains",
    ]);
  return headers;
}
