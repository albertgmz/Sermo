// This device and the member's others, for the notification settings: what state this device is in
// and a short name for each device the account lists. Plain functions, so a test can hold them.

import type { PushAvailability } from "./app-prompts";

export type DeviceStatus =
  // The forum has no push keys.
  | "off-site"
  // The browser cannot receive pushes (or, on iOS, only from the installed app).
  | "unsupported"
  | "needsInstall"
  // The member told the browser no; only the browser's settings can undo it.
  | "blocked"
  | "on"
  | "off";

// The account lists the endpoint as the backend normalized it (a WHATWG URL), the browser as it
// was given: they are compared the same way.
export function sameEndpoint(a: string, b: string) {
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return a === b;
  }
}

export function deviceStatus(env: {
  serverPush: boolean;
  availability: PushAvailability;
  permission: NotificationPermission | null;
  // This browser's subscription, if it has one.
  endpoint: string | null;
  // The endpoints the account lists.
  listed: readonly string[];
}): DeviceStatus {
  if (!env.serverPush) return "off-site";
  if (env.availability !== "available") return env.availability;
  if (env.permission === "denied") return "blocked";
  const { endpoint } = env;
  return env.permission === "granted" &&
    endpoint !== null &&
    env.listed.some((listed) => sameEndpoint(listed, endpoint))
    ? "on"
    : "off";
}

// The member who turned pushes on in this browser (localStorage, cleared by signing out). A
// subscription belongs to the browser and outlives the session that made it (it expires, is signed
// out from another device, ends with a password reset or a ban), so the page checks it against
// whoever is viewing.
export const PUSH_OWNER_KEY = "sermo-push-owner";

// The session (its id, which is no secret) this browser last saved its subscription under, or last
// found the account full under. A session that ends takes its devices with it, so a different
// session now means the account may have lost this one, or still ties it to an older session, and
// it is saved again; the same session means a missing device was removed on purpose (from another
// device) and stays removed. A browser that has none (it subscribed before this was kept) is
// checked once.
export const PUSH_SESSION_KEY = "sermo-push-session";

export function restoreNeeded(env: {
  stored: string | null;
  session: string | null;
}) {
  return env.session !== null && env.stored !== env.session;
}

// Whether this browser's subscription still serves the one viewing: it was turned on by this member
// (a guest or another member would get the previous member's alerts), and for the forum's current
// key (one made for an old key receives nothing). The key is compared only when the forum's could be
// read (`keyMatches` null otherwise), so a backend that cannot be reached for a moment does not end
// every device's pushes.
export function keepsSubscription(env: {
  owner: string | null;
  member: string | null;
  keyMatches: boolean | null;
}) {
  return (
    env.member !== null && env.owner === env.member && env.keyMatches !== false
  );
}

// Browser and system named in a device's user agent, or null for those it does not say. Brand
// names, so they are not translated.
export function deviceName(userAgent: string): {
  browser: string | null;
  system: string | null;
} {
  const browser = /EdgA?\/|EdgiOS/.test(userAgent)
    ? "Edge"
    : /SamsungBrowser/.test(userAgent)
      ? "Samsung Internet"
      : /OPR\/|OPiOS/.test(userAgent)
        ? "Opera"
        : /Firefox\/|FxiOS/.test(userAgent)
          ? "Firefox"
          : /Chrome\/|CriOS/.test(userAgent)
            ? "Chrome"
            : /Safari\//.test(userAgent)
              ? "Safari"
              : null;
  const system = /Android/.test(userAgent)
    ? "Android"
    : /iPhone|iPod/.test(userAgent)
      ? "iPhone"
      : /iPad/.test(userAgent)
        ? "iPad"
        : /CrOS/.test(userAgent)
          ? "ChromeOS"
          : /Windows/.test(userAgent)
            ? "Windows"
            : /Macintosh|Mac OS X/.test(userAgent)
              ? "macOS"
              : /Linux/.test(userAgent)
                ? "Linux"
                : null;
  return { browser, system };
}

// The public key as the Push API takes it: the bytes of its base64url text.
export function keyBytes(key: string) {
  const base64 = key.replace(/-/g, "+").replace(/_/g, "/");
  const text = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}
