// What the service worker does with a push and with a tap on its notification, as plain functions so
// a test can run them (`src/worker/sw.ts` hands them the events).
//
// A push carries what the backend's `pushPayload` writes: a title, a plain-text body, the address
// of the item and a tag that names the notice's group. Every push shows a notification, even one
// that cannot be read: a browser that sees pushes with nothing shown takes the permission away.

import { APP_ICON_URL, BADGE_URL } from "./pwa";

// The app's icon (the uploaded one, or the default mark: `app/pwa-icon/[size]`) and the small
// one-colour mark of the status bar.
export const NOTIFICATION_ICON = APP_ICON_URL;
export const NOTIFICATION_BADGE = BADGE_URL;
// Where a notification that could not be read leads, and where a tap goes when the address it
// carries is not one of the site's.
const UNREAD_PATH = "/notifications";
const HOME_PATH = "/";

export type PushMessage = {
  title: string;
  body: string;
  url: string;
  tag: string;
};

// The message a push carries, or null when it is not one the backend writes.
export function readPush(text: string | null): PushMessage | null {
  if (!text) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const { title, body, url, tag } = (value ?? {}) as Record<string, unknown>;
  if (typeof title !== "string" || !title) return null;
  return {
    title,
    body: typeof body === "string" ? body : "",
    url: typeof url === "string" ? url : "",
    tag: typeof tag === "string" ? tag : "",
  };
}

export type ShownNotification = {
  title: string;
  options: {
    body: string;
    icon: string;
    badge: string;
    tag?: string;
    renotify?: boolean;
    data: { url: string };
  };
};

// The notification for a message. One with a tag replaces the device's earlier notification of the
// same group and still alerts (`renotify`). One that could not be read says only the site's host
// and leads to the alert list.
export function notificationOf(
  message: PushMessage | null,
  origin: string,
): ShownNotification {
  const base = {
    icon: NOTIFICATION_ICON,
    badge: NOTIFICATION_BADGE,
  };
  if (!message)
    return {
      title: new URL(origin).host,
      options: { ...base, body: "", data: { url: UNREAD_PATH } },
    };
  return {
    title: message.title,
    options: {
      ...base,
      body: message.body,
      ...(message.tag ? { tag: message.tag, renotify: true } : {}),
      data: { url: message.url },
    },
  };
}

// The address a tap opens: the item's exactly as the push carries it (the backend links each item
// by its permalink, which the site resolves to the right page), read against the worker's own
// origin. Only an address of the site is opened, every one of which is in the app's scope (`/`);
// anything else (another origin, a backend that fell back to a local base address, garbage) opens
// the site's home.
export function targetUrl(raw: unknown, origin: string): string {
  if (typeof raw === "string" && raw)
    try {
      const url = new URL(raw, origin);
      if (url.origin === origin) return url.href;
    } catch {}
  return new URL(HOME_PATH, origin).href;
}

export type WindowLike = {
  focused: boolean;
  visibilityState: string;
  focus(): Promise<WindowLike>;
  navigate(url: string): Promise<WindowLike | null>;
};

// The window of the site a tap goes to: the one in front, else one that is showing, else any (on a
// phone that was locked or showing another app every window is hidden). Reusing a window keeps a
// tap from leaving a new browser tab behind each time. `Client.url` is not used: it keeps the
// address of the last full load, not the page shown now.
export function pickWindow<T extends WindowLike>(windows: readonly T[]) {
  return (
    windows.find((client) => client.focused) ??
    windows.find((client) => client.visibilityState === "visible") ??
    windows[0] ??
    null
  );
}

// What a tap does. A window of the site is brought forward and moved to the address; only when the
// site has no window does a new one open there (in the installed app where the system gives the
// site's addresses to it). The worker is handed only the windows it controls (`navigate` refuses
// the others). A move that fails falls back to a new window, which the browser may refuse once the
// tap's permission to focus is spent: iOS home-screen apps are known to fail `navigate` (WebKit bug
// 263687), and there the app may come forward on the page it had.
export async function openTarget(
  raw: unknown,
  scope: {
    origin: string;
    windows(): Promise<readonly WindowLike[]>;
    openWindow(url: string): Promise<unknown>;
  },
) {
  const url = targetUrl(raw, scope.origin);
  const client = pickWindow(await scope.windows());
  if (client)
    try {
      const focused = await client.focus();
      if (await focused.navigate(url)) return;
    } catch {}
  await scope.openWindow(url);
}

export type SubscriptionLike = {
  endpoint: string;
  options?: { applicationServerKey: ArrayBuffer | null };
  toJSON(): { keys?: Record<string, string> };
  unsubscribe(): Promise<boolean>;
};

// Where the worker tells the account about a subscription the browser replaced
// (`app/push/subscription`).
export const RENEW_PATH = "/push/subscription";

// The browser dropped or replaced this device's subscription (`pushsubscriptionchange`: the push
// service expired or rotated it). The worker subscribes again with the old one's key when the
// browser made no new one, and hands the new one to the account in place of the old, as the member
// whose session cookie the request carries. When the account refuses it (signed out, refused) the new
// subscription is taken back (not when the request could not be made), so the device is not left subscribed for nothing and the
// page offers pushes again. Without the old key (some browsers give none) nothing is done; the page
// then finds no subscription and offers pushes again.
export async function renewSubscription(
  change: {
    oldSubscription: SubscriptionLike | null;
    newSubscription: SubscriptionLike | null;
  },
  scope: {
    subscribe(key: ArrayBuffer): Promise<SubscriptionLike>;
    send(body: string): Promise<{ ok: boolean }>;
  },
) {
  const key = change.oldSubscription?.options?.applicationServerKey ?? null;
  const next =
    change.newSubscription ?? (key ? await scope.subscribe(key) : null);
  if (!next) return;
  const keys = next.toJSON().keys ?? {};
  const sent = await scope
    .send(
      JSON.stringify({
        previous: change.oldSubscription?.endpoint ?? null,
        endpoint: next.endpoint,
        keys: { p256dh: keys.p256dh ?? "", auth: keys.auth ?? "" },
      }),
    )
    .catch(() => null);
  if (sent && !sent.ok) await next.unsubscribe().catch(() => false);
}
