import { headers } from "next/headers";
import type { Browser, ClientInfo, Os } from "@/lib/types";

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

export async function getClientInfo(): Promise<ClientInfo> {
  return parseUserAgent((await headers()).get("user-agent") ?? "");
}
