export type Browser =
  | "chrome"
  | "firefox"
  | "safari"
  | "edge"
  | "opera"
  | "other";

export type Os = "windows" | "macos" | "linux" | "android" | "ios" | "other";

export type ClientInfo = {
  browser: Browser;
  os: Os;
};

const BROWSERS: [Browser, RegExp][] = [
  ["edge", /Edg(e|A|iOS)?\//],
  ["opera", /OPR\/|Opera/],
  ["firefox", /Firefox\/|FxiOS\//],
  ["chrome", /Chrome\/|CriOS\//],
  ["safari", /Safari\//],
];

const SYSTEMS: [Os, RegExp][] = [
  ["android", /Android/],
  ["ios", /iPhone|iPad|iPod/],
  ["windows", /Windows/],
  ["macos", /Mac OS X|Macintosh/],
  ["linux", /Linux|X11|CrOS/],
];

export function parseUserAgent(ua: string): ClientInfo {
  return {
    browser: BROWSERS.find(([, pattern]) => pattern.test(ua))?.[0] ?? "other",
    os: SYSTEMS.find(([, pattern]) => pattern.test(ua))?.[0] ?? "other",
  };
}
