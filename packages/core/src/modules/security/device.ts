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

/** User agents kept in memory (per cache); the least recently used goes first. */
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
const devices = new Map<string, Device>();
const bots = new Map<string, boolean>();
let parses = 0;

/** How many user agents were parsed rather than served from a cache (for tests). */
export function deviceParseCount(): number {
  return parses;
}

export function clearDeviceCache(): void {
  devices.clear();
  bots.clear();
}

function remembered<T>(cache: Map<string, T>, key: string, make: () => T): T {
  const hit = cache.get(key);
  if (hit !== undefined) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const value = make();
  cache.set(key, value);
  if (cache.size > DEVICE_CACHE_SIZE) cache.delete(cache.keys().next().value as string);
  return value;
}

const blank = (value: string | undefined): string | null => (value ? value : null);

// A user agent nobody can read must not fail the post, the sign-in or the view that carries it.
function safely<T>(fallback: T, run: () => T): T {
  parses += 1;
  try {
    return run();
  } catch (error) {
    console.error("A user agent could not be parsed", error);
    return fallback;
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
  return remembered(devices, userAgent, () => safely(NO_DEVICE, () => detect(userAgent)));
}

/**
 * Whether a user agent is a crawler, by the cheap check alone (the full parse costs about twice
 * as much): for the hot read that counts thread views. A user agent whose device is already
 * cached is answered from there.
 */
export function isBotAgent(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const userAgent = raw.slice(0, MAX_USER_AGENT);
  const known = devices.get(userAgent);
  if (known) return known.isBot;
  return remembered(bots, userAgent, () =>
    safely(false, () => Boolean(detector.parseBot(userAgent).name)),
  );
}
