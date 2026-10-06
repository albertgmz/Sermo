import webPush from "web-push";
import type { Ctx } from "../../context";

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

interface PushOptions {
  vapid: VapidConfig | null;
  /** An exact local origin for the in-process TLS push endpoint in tests. */
  testAllowedEndpointOrigin?: string;
  /** A certificate authority the in-process test endpoint's certificate chains to. */
  testCa?: string | Buffer;
  /** A shorter send deadline for tests. */
  testTimeoutMs?: number;
}

interface PushConfig extends PushOptions {
  jobsRegistered: boolean;
}

const configurations = new WeakMap<Ctx, PushConfig>();

export function validatePushVapid(vapid: VapidConfig | null): void {
  if (vapid) webPush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
}

export function configurePush(ctx: Ctx, options: PushOptions): void {
  configurations.set(ctx, { ...options, jobsRegistered: false });
}

export function pushVapid(ctx: Ctx): VapidConfig | null {
  return configurations.get(ctx)?.vapid ?? null;
}

/** The send deadline and any test certificate authority. */
export function pushTransport(ctx: Ctx): { timeoutMs: number; ca?: string | Buffer } {
  const config = configurations.get(ctx);
  return { timeoutMs: config?.testTimeoutMs ?? 10_000, ca: config?.testCa };
}

export function markPushJobsRegistered(ctx: Ctx): void {
  const config = configurations.get(ctx);
  if (config?.vapid) config.jobsRegistered = true;
}

export function pushJobsReady(ctx: Ctx): boolean {
  return configurations.get(ctx)?.jobsRegistered ?? false;
}

/** The WHATWG serialization of an endpoint, or null when it does not parse. */
export function normalizePushEndpoint(endpoint: string): string | null {
  try {
    return new URL(endpoint).href;
  } catch {
    return null;
  }
}

const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** The normalized endpoint when it belongs to a push service, else null. */
export function allowedPushEndpoint(ctx: Ctx, endpoint: string): string | null {
  if (!endpoint.startsWith("https://")) return null;
  // Userinfo is refused before any parsing.
  if (
    endpoint
      .slice("https://".length)
      .split(/[/?#\\]/, 1)[0]!
      .includes("@")
  )
    return null;
  const href = normalizePushEndpoint(endpoint);
  if (!href) return null;
  const url = new URL(href);
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const testOrigin = configurations.get(ctx)?.testAllowedEndpointOrigin;
  if (testOrigin && url.origin === testOrigin) return href;
  const host = url.hostname;
  return HOSTNAME.test(host) &&
    (host === "fcm.googleapis.com" ||
      host.endsWith(".push.services.mozilla.com") ||
      host.endsWith(".notify.windows.com") ||
      host.endsWith(".push.apple.com")) &&
    !url.port
    ? href
    : null;
}
