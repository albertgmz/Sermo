// What this browser can do about the app and its notifications: which platform it is, whether it
// can install the forum, and whether it can receive pushes. Plain functions, so a test can hold them.

export type Platform = {
  ios: boolean;
  // Safari itself, which can add the site to the home screen as an app.
  iosSafari: boolean;
  // Running as the installed app.
  standalone: boolean;
};

const IOS_DEVICE = /iPhone|iPad|iPod/;
// Browsers on iOS that are not Safari, and the in-app browsers of other apps.
const IOS_OTHER =
  /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|YaBrowser|GSA\/|DuckDuckGo|FBAN|FBAV|Instagram|Line\//;

// iPadOS asks for desktop pages and says it is a Mac; a touch screen gives it away.
export function platformOf(env: {
  userAgent: string;
  maxTouchPoints: number;
  // `navigator.standalone` (iOS) or `display-mode: standalone`.
  standalone: boolean;
}): Platform {
  const ios =
    IOS_DEVICE.test(env.userAgent) ||
    (/Macintosh/.test(env.userAgent) && env.maxTouchPoints > 1);
  return {
    ios,
    iosSafari:
      ios && /Safari\//.test(env.userAgent) && !IOS_OTHER.test(env.userAgent),
    standalone: env.standalone,
  };
}

export type InstallOffer = "native" | "ios" | null;

// How the forum can be installed here: through the browser's own dialog, by the steps of iOS
// Safari, or not at all.
export function installOffer(
  platform: Platform,
  nativeEvent: boolean,
): InstallOffer {
  if (platform.standalone) return null;
  if (nativeEvent) return "native";
  if (platform.iosSafari) return "ios";
  return null;
}

export type PushAvailability = "available" | "needsInstall" | "unsupported";

// Whether this browser can receive pushes. `apis`: service workers, the Push API and notifications
// on a secure page; `worker`: the build registers its service worker (production).
export function pushAvailability(env: {
  apis: boolean;
  worker: boolean;
  platform: Platform;
}): PushAvailability {
  if (env.platform.ios && !env.platform.standalone)
    return env.platform.iosSafari ? "needsInstall" : "unsupported";
  return env.apis && env.worker ? "available" : "unsupported";
}
