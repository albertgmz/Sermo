import type { MetadataRoute } from "next";

// What makes the forum installable: the web app manifest and the paths the proxy leaves alone
// (see `isPwaPath`). The service worker's own rules are in `pwa-routes.ts`.

// The page the worker answers with when a page cannot be loaded because the network is gone. A
// static file of `public/` that the worker keeps from its first visit.
export const OFFLINE_URL = "/offline.html";

// Where the worker script is served from (`public/sw.js`, written by `scripts/build-sw.ts`), and the
// scope it controls: the whole site.
export const WORKER_URL = "/sw.js";
export const WORKER_SCOPE = "/";

export const MANIFEST_URL = "/manifest.webmanifest";
const ICON_PREFIX = "/pwa-icon/";
// The default home-screen icon of iOS, served beside the manifest's.
export const APPLE_ICON_URL = `${ICON_PREFIX}180`;
// The default icon at the size the install card and a notification show, and the badge of a
// notification (`app/pwa-icon/[size]`).
export const APP_ICON_URL = `${ICON_PREFIX}192`;
export const BADGE_URL = `${ICON_PREFIX}badge`;

// Colours of a manifest are literal: it is read by the operating system, not by the page, so the
// tokens of globals.css cannot reach it. The accent is `--primary`; the splash background is that
// of the light theme, the default.
const DEFAULT_ACCENT = "#dc2626";

// The colour the browser gives its bar above the page (`theme-color`), read by the browser like the
// manifest: `--background` of each theme, which the sticky header shares.
export const THEME_COLORS = { light: "#fafafa", dark: "#151521" } as const;

// The addresses that belong to the installable app and sit outside the language segment: the
// proxy lets them through as they are, without a language, a record check or a 404.
export function isPwaPath(pathname: string) {
  return (
    pathname === MANIFEST_URL ||
    pathname === OFFLINE_URL ||
    pathname.startsWith(ICON_PREFIX) ||
    pathname === WORKER_URL
  );
}

type Site = {
  name: string;
  description: string;
  icon: { url: string } | null;
  accents: { color: string }[];
};

// The name under the icon on a home screen has room for about a dozen characters.
const SHORT_NAME_LENGTH = 12;

export function shortName(name: string) {
  if (name.length <= SHORT_NAME_LENGTH) return name;
  const first = name.split(/\s+/)[0];
  return first.length <= SHORT_NAME_LENGTH
    ? first
    : name.slice(0, SHORT_NAME_LENGTH).trim();
}

// An uploaded icon is a 512 pixel square; a site without one gets the default mark in the two
// sizes browsers ask for.
function iconsOf(icon: Site["icon"]): MetadataRoute.Manifest["icons"] {
  if (icon) return [{ src: icon.url, sizes: "512x512", type: "image/png" }];
  return [
    { src: `${ICON_PREFIX}192`, sizes: "192x192", type: "image/png" },
    { src: `${ICON_PREFIX}512`, sizes: "512x512", type: "image/png" },
    {
      src: `${ICON_PREFIX}512`,
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ];
}

// The first accent is the site's own colour. `site` is what the layout reads (`getSite`), which is
// already the fallback when the backend cannot be reached: the default name, no description, no
// icon and no accents. `withIcons` is false when LITE mode hides the brand pictures.
export function manifestOf(
  site: Site,
  withIcons = true,
): MetadataRoute.Manifest {
  return {
    id: "/",
    name: site.name,
    short_name: shortName(site.name),
    ...(site.description ? { description: site.description } : {}),
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: THEME_COLORS.light,
    theme_color: site.accents[0]?.color ?? DEFAULT_ACCENT,
    ...(withIcons ? { icons: iconsOf(site.icon) } : {}),
  };
}
