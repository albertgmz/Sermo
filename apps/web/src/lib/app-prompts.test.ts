import { expect, test } from "bun:test";
import { installOffer, platformOf, pushAvailability } from "./app-prompts";

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
