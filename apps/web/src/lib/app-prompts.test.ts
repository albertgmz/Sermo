import { expect, test } from "bun:test";
import {
  cardToShow,
  installOffer,
  type PromptState,
  pageSeen,
  platformOf,
  pushAvailability,
  readSnoozes,
  readVisit,
  SNOOZE_DAYS,
  snoozed,
} from "./app-prompts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 19, 12);

const UA = {
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1",
  iphoneFacebook:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/500.0]",
  ipad: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
  firefoxDesktop:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0",
};

test("iOS Safari is told apart from other iOS browsers, and an iPad that says it is a Mac is iOS", () => {
  const of = (userAgent: string, maxTouchPoints = 5, standalone = false) =>
    platformOf({ userAgent, maxTouchPoints, standalone });
  expect(of(UA.iphoneSafari)).toEqual({
    ios: true,
    iosSafari: true,
    standalone: false,
  });
  expect(of(UA.iphoneChrome).iosSafari).toBe(false);
  expect(of(UA.iphoneFacebook).iosSafari).toBe(false);
  expect(of(UA.ipad).iosSafari).toBe(true);
  // A Mac with no touch screen is a Mac.
  expect(of(UA.ipad, 0).ios).toBe(false);
  expect(of(UA.androidChrome).ios).toBe(false);
});

const desktop = platformOf({
  userAgent: UA.firefoxDesktop,
  maxTouchPoints: 0,
  standalone: false,
});
const iphone = platformOf({
  userAgent: UA.iphoneSafari,
  maxTouchPoints: 5,
  standalone: false,
});
const iphoneApp = { ...iphone, standalone: true };
const android = platformOf({
  userAgent: UA.androidChrome,
  maxTouchPoints: 5,
  standalone: false,
});

test("the install offer: the browser's dialog, iOS Safari's steps, or nothing", () => {
  expect(installOffer(android, true)).toBe("native");
  expect(installOffer(iphone, false)).toBe("ios");
  // Firefox desktop has no install event, and is not iOS.
  expect(installOffer(desktop, false)).toBeNull();
  // Inside the installed app nothing is offered.
  expect(installOffer({ ...android, standalone: true }, true)).toBeNull();
  expect(installOffer(iphoneApp, false)).toBeNull();
  const chromeOnIphone = platformOf({
    userAgent: UA.iphoneChrome,
    maxTouchPoints: 5,
    standalone: false,
  });
  expect(installOffer(chromeOnIphone, false)).toBeNull();
});

test("pushes need the browser's APIs and the worker, and on iOS the installed app", () => {
  expect(
    pushAvailability({ apis: true, worker: true, platform: android }),
  ).toBe("available");
  expect(
    pushAvailability({ apis: true, worker: false, platform: android }),
  ).toBe("unsupported");
  expect(
    pushAvailability({ apis: false, worker: true, platform: android }),
  ).toBe("unsupported");
  // iOS Safari exposes no Push API outside the app; it is told to install first.
  expect(pushAvailability({ apis: true, worker: true, platform: iphone })).toBe(
    "needsInstall",
  );
  expect(
    pushAvailability({ apis: true, worker: true, platform: iphoneApp }),
  ).toBe("available");
});

test("'Not now' holds a card back for 30 days", () => {
  const snoozes = { install: NOW };
  expect(snoozed(snoozes, "install", NOW + (SNOOZE_DAYS - 1) * DAY)).toBe(true);
  expect(snoozed(snoozes, "install", NOW + SNOOZE_DAYS * DAY)).toBe(false);
  expect(snoozed(snoozes, "push", NOW)).toBe(false);
});

test("what the browser stored is read safely", () => {
  expect(readSnoozes(null)).toEqual({});
  expect(readSnoozes("garbage")).toEqual({});
  expect(readSnoozes('{"install":5,"push":"x","other":1}')).toEqual({
    install: 5,
  });
  const none = { views: 0, card: null, installed: false, member: null };
  expect(readVisit(null)).toEqual(none);
  expect(readVisit("[")).toEqual(none);
  expect(
    readVisit('{"views":3,"card":"push","installed":true,"member":"m"}'),
  ).toEqual({ views: 3, card: "push", installed: true, member: "m" });
  expect(readVisit('{"card":"other"}').card).toBeNull();
});

// A member of long standing on an Android phone, on the third page of a visit, nothing decided yet.
const base: PromptState = {
  consentSettled: true,
  install: null,
  member: { createdAt: NOW - 400 * DAY },
  push: "available",
  permission: "default",
  subscribed: false,
  serverPush: true,
  snoozes: {},
  visit: { views: 3, card: null, installed: false, member: "m" },
  now: NOW,
};

test("nothing is shown before the cookie banner is answered", () => {
  expect(cardToShow(base)).toBe("push");
  expect(cardToShow({ ...base, consentSettled: false })).toBeNull();
  expect(
    cardToShow({ ...base, install: "native", consentSettled: false }),
  ).toBeNull();
});

test("the notification card: members only, while the browser has not been asked", () => {
  expect(cardToShow({ ...base, member: null })).toBeNull();
  // Allowed before, and still subscribed: nothing to ask.
  expect(
    cardToShow({ ...base, permission: "granted", subscribed: true }),
  ).toBeNull();
  // Allowed before, but the subscription went (a sign-out clears it): offered again.
  expect(cardToShow({ ...base, permission: "granted" })).toBe("push");
  expect(cardToShow({ ...base, permission: "denied" })).toBeNull();
  expect(cardToShow({ ...base, permission: null })).toBeNull();
  expect(cardToShow({ ...base, push: "unsupported" })).toBeNull();
  expect(cardToShow({ ...base, push: "needsInstall" })).toBeNull();
  // A forum without push keys asks nothing.
  expect(cardToShow({ ...base, serverPush: false })).toBeNull();
  expect(cardToShow({ ...base, snoozes: { push: NOW - DAY } })).toBeNull();
  expect(
    cardToShow({ ...base, snoozes: { push: NOW - SNOOZE_DAYS * DAY } }),
  ).toBe("push");
});

test("a member who just signed up is not asked on the first page of the visit", () => {
  const newcomer = { ...base, member: { createdAt: NOW - 5 * 60 * 1000 } };
  expect(
    cardToShow({ ...newcomer, visit: { ...base.visit, views: 1 } }),
  ).toBeNull();
  expect(cardToShow({ ...newcomer, visit: { ...base.visit, views: 2 } })).toBe(
    "push",
  );
  // A member of long standing may be asked on any page.
  expect(cardToShow({ ...base, visit: { ...base.visit, views: 1 } })).toBe(
    "push",
  );
});

test("the install card is for guests and members alike, and comes first", () => {
  expect(cardToShow({ ...base, install: "native" })).toBe("install");
  expect(cardToShow({ ...base, member: null, install: "ios" })).toBe("install");
  expect(
    cardToShow({ ...base, install: "native", snoozes: { install: NOW } }),
  ).toBe("push");
});

test("a visit keeps to its card: notifications wait for a later visit, or for the install", () => {
  const afterInstallCard = {
    ...base,
    install: "native" as const,
    visit: {
      views: 4,
      card: "install" as const,
      installed: false,
      member: "m",
    },
  };
  expect(cardToShow(afterInstallCard)).toBe("install");
  // Put off: the rest of the visit shows nothing.
  expect(
    cardToShow({ ...afterInstallCard, snoozes: { install: NOW } }),
  ).toBeNull();
  // Installed: the browser offers no more install, and the notification card may follow.
  expect(
    cardToShow({
      ...afterInstallCard,
      install: null,
      visit: { ...afterInstallCard.visit, installed: true },
    }),
  ).toBe("push");
  // A visit that showed the notification card does not switch to the install card.
  expect(
    cardToShow({
      ...base,
      install: "native",
      visit: { views: 2, card: "push", installed: false, member: "m" },
    }),
  ).toBe("push");
  expect(
    cardToShow({
      ...base,
      install: "native",
      permission: "granted",
      subscribed: true,
      visit: { views: 2, card: "push", installed: false, member: "m" },
    }),
  ).toBeNull();
});

test("on iOS the install steps come first and the notification card waits for the app", () => {
  const safari = {
    ...base,
    install: installOffer(iphone, false),
    push: pushAvailability({ apis: false, worker: true, platform: iphone }),
  };
  expect(cardToShow(safari)).toBe("install");
  expect(cardToShow({ ...safari, snoozes: { install: NOW } })).toBeNull();
  const app = {
    ...base,
    install: installOffer(iphoneApp, false),
    push: pushAvailability({ apis: true, worker: true, platform: iphoneApp }),
  };
  expect(cardToShow(app)).toBe("push");
});

test("the pages of a visit count again from signing in, so a guest who signs up is new on their first page", () => {
  const guest = { views: 0, card: null, installed: false, member: null };
  const browsing = pageSeen(pageSeen(pageSeen(guest, null), null), null);
  expect(browsing.views).toBe(3);
  const joined = pageSeen(
    { ...browsing, card: "install" },
    "2026-10-19T12:00:00.000Z",
  );
  expect(joined).toEqual({
    views: 1,
    card: "install",
    installed: false,
    member: "2026-10-19T12:00:00.000Z",
  });
  expect(pageSeen(joined, joined.member).views).toBe(2);
  // Signing out counts again too.
  expect(pageSeen(joined, null).views).toBe(1);
});
