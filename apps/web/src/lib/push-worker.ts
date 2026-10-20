// What the service worker does with a push and with a tap on its notification, as plain functions so
// a test can run them (`src/worker/sw.ts` hands them the events).
//
// A push carries what the backend's `pushPayload` writes: a title, a plain-text body, the address
// of the item and a tag that names the notice's group. Every push shows a notification, even one
// that cannot be read: a browser that sees pushes with nothing shown takes the permission away.

// The app's icon (the uploaded one, or the default mark: `app/pwa-icon/[size]`) and the small
// one-colour mark of the status bar.
export const NOTIFICATION_ICON = "/pwa-icon/192";
export const NOTIFICATION_BADGE = "/pwa-icon/badge";
// Where a notification without a usable address leads.
const FALLBACK_PATH = "/notifications";

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
      options: { ...base, body: "", data: { url: FALLBACK_PATH } },
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

// The address a tap opens: the item's, read against the site, or the alert list when there is none
// that a window can open.
export function targetUrl(raw: unknown, origin: string): string {
  if (typeof raw === "string" && raw)
    try {
      const url = new URL(raw, origin);
      if (url.protocol === "https:" || url.protocol === "http:")
        return url.href;
    } catch {}
  return new URL(FALLBACK_PATH, origin).href;
}

export type WindowLike = {
  focused: boolean;
  visibilityState: string;
  focus(): Promise<WindowLike>;
  navigate(url: string): Promise<WindowLike | null>;
};

// The window of the site a tap goes to: the one in front, else one that is showing, else any.
// `Client.url` is not used: it keeps the address of the last full load, not the page shown now.
export function pickWindow<T extends WindowLike>(windows: readonly T[]) {
  return (
    windows.find((client) => client.focused) ??
    windows.find((client) => client.visibilityState === "visible") ??
    windows[0] ??
    null
  );
}

// What a tap does. An address of the site goes to a window the site already has, brought to the
// front and moved there; with none (or one the worker does not control, which cannot be moved) it
// opens a new window. Every address of the site is in the app's scope, so on a device where the app
// is installed that window is the app's own. An address elsewhere opens on its own and leaves the
// site's windows as they are.
export async function openTarget(
  raw: unknown,
  scope: {
    origin: string;
    windows(): Promise<readonly WindowLike[]>;
    openWindow(url: string): Promise<unknown>;
  },
) {
  const url = targetUrl(raw, scope.origin);
  if (new URL(url).origin === scope.origin) {
    const client = pickWindow(await scope.windows());
    if (client)
      try {
        const focused = await client.focus();
        if (await focused.navigate(url)) return;
      } catch {}
  }
  await scope.openWindow(url);
}
