import DeviceDetector from "node-device-detector";

/** What is kept of a request's user agent: parsed, never the raw string. */
export interface Device {
  readonly browser: string | null;
  readonly os: string | null;
  readonly deviceType: string | null;
  readonly brand: string | null;
  readonly model: string | null;
  readonly isBot: boolean;
}

export const NO_DEVICE: Device = Object.freeze({
  browser: null,
  os: null,
  deviceType: null,
  brand: null,
  model: null,
  isBot: false,
});

/** User agents kept parsed in memory; the oldest goes first. */
export const DEVICE_CACHE_SIZE = 1000;

/** Longer user agents are cut before they are parsed or used as a cache key. */
const MAX_USER_AGENT = 300;

const detector = new DeviceDetector({
  clientIndexes: true,
  deviceIndexes: true,
  osIndexes: true,
  maxUserAgentSize: MAX_USER_AGENT,
});

// A Map keeps insertion order, so the first key is the least recently used one when a hit
// re-inserts its entry.
const cache = new Map<string, Device>();
let parses = 0;

/** How many user agents were parsed rather than served from the cache (for tests). */
export function deviceParseCount(): number {
  return parses;
}

export function clearDeviceCache(): void {
  cache.clear();
}

const blank = (value: string | undefined): string | null => (value ? value : null);

/**
 * The detector walks its pattern lists with `for...in`, which also visits any enumerable member a
 * dependency has added to a built-in prototype (drizzle-kit adds `Array.prototype.random`), reads
 * it as a pattern and throws. Such members are made non-enumerable (nothing else changes) before
 * every parse.
 */
function hideInheritedMembers(): void {
  for (const prototype of [Array.prototype, Object.prototype] as object[]) {
    const inherited: string[] = [];
    for (const key in prototype) inherited.push(key);
    for (const key of inherited) Object.defineProperty(prototype, key, { enumerable: false });
  }
}

function parse(userAgent: string): Device {
  parses += 1;
  hideInheritedMembers();
  try {
    return detect(userAgent);
  } catch (error) {
    // A user agent nobody can read must not fail the post or the sign-in that carries it.
    console.error("A user agent could not be parsed", error);
    return NO_DEVICE;
  }
}

function detect(userAgent: string): Device {
  const bot = detector.parseBot(userAgent);
  if (bot.name) return { ...NO_DEVICE, browser: bot.name, isBot: true };
  const result = detector.detect(userAgent);
  return {
    browser: blank(result.client.name),
    os: blank(result.os.name),
    deviceType: blank(result.device.type),
    brand: blank(result.device.brand),
    model: blank(result.device.model),
    isBot: false,
  };
}

/** The device behind a user agent, from a bounded in-memory cache keyed by the string. */
export function deviceOf(raw: string | null | undefined): Device {
  if (!raw) return NO_DEVICE;
  const userAgent = raw.slice(0, MAX_USER_AGENT);
  const hit = cache.get(userAgent);
  if (hit) {
    cache.delete(userAgent);
    cache.set(userAgent, hit);
    return hit;
  }
  const device = parse(userAgent);
  cache.set(userAgent, device);
  if (cache.size > DEVICE_CACHE_SIZE) cache.delete(cache.keys().next().value as string);
  return device;
}
