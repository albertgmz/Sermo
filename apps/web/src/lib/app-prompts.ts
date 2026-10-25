// When the forum offers to be installed as an app and to send notifications: the rules as plain
// functions, so a test can hold them (`components/layout/app-prompts.tsx` reads the browser and
// draws the card). One card at a time, only once the cookie banner is out of the way, and "Not now"
// keeps a card away for 30 days.
//
// - Install: where the browser offers it (`beforeinstallprompt`: Chrome, Edge, Samsung Internet on
//   Android and desktop), or on iOS Safari, which has no such event and is shown the steps instead.
//   Never inside the installed app, and never where neither applies (Firefox desktop, other iOS
//   browsers).
// - Notifications: signed-in members whose browser can receive pushes, while the browser has not
//   been asked yet (once it has, the browser remembers the answer and only the settings can change
//   it) or was allowed but holds no subscription any more, and only when the forum can send them.
//   On iOS a page can receive pushes only from the installed app (iOS 16.4 and later), so the card
//   waits for it there.
// - The install card comes first; the notification card follows on a later visit, or in the same
//   one once the app has been installed. A member who has just signed up (an account younger than a
//   day) is not asked about notifications on the first page they see signed in.

export const SNOOZE_DAYS = 30;
// After the cookie banner, a moment for the browser to say it can install the forum: the install
// card comes first, and the event can come after the banner of a returning visitor has settled.
// A guest's invitation to create an account waits the same moment (`SignupNudges`).
export const GRACE_MS = 1500;
const DAY = 24 * 60 * 60 * 1000;
// A member whose account is younger than this is treated as having signed up in this visit.
const NEW_MEMBER = DAY;

// Kept in the browser: when each card was last put off (localStorage, epoch milliseconds), and the
// visit (sessionStorage: the pages seen and the card shown). Both are in the cookie inventory.
export const PROMPTS_KEY = "sermo-app-prompts";
export const VISIT_KEY = "sermo-app-visit";

export type Card = "install" | "push";

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

// What the account menu's "Install app" offers: the same as the card, but only to someone who put
// the card off (a card not put off is on its way, or already in front of them).
export function menuInstallOffer(
  platform: Platform,
  nativeEvent: boolean,
  snoozes: Snoozes,
  now: number,
): InstallOffer {
  return snoozed(snoozes, "install", now)
    ? installOffer(platform, nativeEvent)
    : null;
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

export type Snoozes = Partial<Record<Card, number>>;

export const snoozed = (snoozes: Snoozes, card: Card, now: number) =>
  (snoozes[card] ?? -Infinity) + SNOOZE_DAYS * DAY > now;

// The stored snoozes, from whatever the storage held.
export function readSnoozes(text: string | null): Snoozes {
  try {
    const value = JSON.parse(text ?? "{}") as Record<string, unknown>;
    const snoozes: Snoozes = {};
    for (const card of ["install", "push"] as const)
      if (typeof value?.[card] === "number") snoozes[card] = value[card];
    return snoozes;
  } catch {
    return {};
  }
}

// A visit: the pages seen since the visitor last signed in or out (`member` names who was counted:
// the account's creation time, or null for a guest), the card it showed, and whether the app was
// installed in it.
export type Visit = {
  views: number;
  card: Card | null;
  installed: boolean;
  member: string | null;
};

const NEW_VISIT: Visit = {
  views: 0,
  card: null,
  installed: false,
  member: null,
};

export function readVisit(text: string | null): Visit {
  try {
    const value = JSON.parse(text ?? "{}") as Record<string, unknown>;
    return {
      views: typeof value?.views === "number" ? value.views : 0,
      card:
        value?.card === "install" || value?.card === "push" ? value.card : null,
      installed: value?.installed === true,
      member: typeof value?.member === "string" ? value.member : null,
    };
  } catch {
    return NEW_VISIT;
  }
}

// One page more in the visit. Signing in or out starts the count again, so the first page a new
// member sees is their first, whatever they read as a guest before signing up.
export function pageSeen(visit: Visit, member: string | null): Visit {
  return visit.member === member
    ? { ...visit, views: visit.views + 1 }
    : { ...visit, member, views: 1 };
}

export type PromptState = {
  // The cookie banner has been answered, or is not shown to this visitor.
  consentSettled: boolean;
  install: InstallOffer;
  // The member, or null for a guest.
  member: { createdAt: number } | null;
  push: PushAvailability;
  permission: NotificationPermission | null;
  // This browser holds a push subscription.
  subscribed: boolean;
  // The forum has push keys (`push.publicKey`).
  serverPush: boolean;
  snoozes: Snoozes;
  visit: Visit;
  now: number;
};

function installWanted(state: PromptState) {
  return (
    state.install !== null && !snoozed(state.snoozes, "install", state.now)
  );
}

function pushWanted(state: PromptState) {
  const { member, visit, now } = state;
  if (!member || !state.serverPush) return false;
  if (state.push !== "available") return false;
  // Not asked yet; or allowed once, with the subscription gone since (a sign-out clears it, and so
  // does a change of the forum's keys): Turn on then subscribes without asking again.
  const { permission } = state;
  if (
    permission !== "default" &&
    !(permission === "granted" && !state.subscribed)
  )
    return false;
  if (snoozed(state.snoozes, "push", now)) return false;
  // Not on the first page of the visit in which they signed up.
  return !(visit.views <= 1 && now - member.createdAt < NEW_MEMBER);
}

// The card to show now, if any. Once a card has been shown in a visit, that visit keeps to it: the
// install card is followed by the notification card only after the app was installed.
export function cardToShow(state: PromptState): Card | null {
  if (!state.consentSettled) return null;
  const { card, installed } = state.visit;
  if (card === "push") return pushWanted(state) ? "push" : null;
  if (card === "install") {
    if (installWanted(state)) return "install";
    return installed && pushWanted(state) ? "push" : null;
  }
  if (installWanted(state)) return "install";
  return pushWanted(state) ? "push" : null;
}
