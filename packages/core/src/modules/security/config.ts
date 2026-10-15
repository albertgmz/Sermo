import type { ClientLocation } from "../../actor";
import type { Ctx } from "../../context";
import { parseAddress } from "./address";
import { cleanCountry, cleanPlace, NO_LOCATION } from "./location";

/** Looks an address up in a local database; null when it knows nothing about it. */
export type GeoLookup = (ip: string) => ClientLocation | null;

export interface SecurityOptions {
  /** Days an `ip_log` row is kept (default 180). */
  ipLogRetentionDays?: number;
  /** The MaxMind lookup for addresses that arrive without a trusted location; none by default. */
  geoLookup?: GeoLookup | null;
}

export const DEFAULT_IP_LOG_RETENTION_DAYS = 180;

const configurations = new WeakMap<Ctx, SecurityOptions>();

export function configureSecurity(ctx: Ctx, options: SecurityOptions): void {
  configurations.set(ctx, { ...options });
}

export function ipLogRetentionDays(ctx: Ctx): number {
  return configurations.get(ctx)?.ipLogRetentionDays ?? DEFAULT_IP_LOG_RETENTION_DAYS;
}

/** The location of a request: the one the trusted proxy gave, else the database's, else none. */
export function resolveLocation(
  ctx: Ctx,
  ip: string,
  reported: ClientLocation | null | undefined,
): ClientLocation {
  if (reported && (reported.country || reported.region || reported.city)) return reported;
  const lookup = configurations.get(ctx)?.geoLookup;
  if (!lookup || !parseAddress(ip)) return NO_LOCATION;
  try {
    const found = lookup(ip);
    if (!found) return NO_LOCATION;
    return {
      country: cleanCountry(found.country),
      region: cleanPlace(found.region),
      city: cleanPlace(found.city),
    };
  } catch (error) {
    // A broken database must not fail the sign-in or the post that carries the address.
    console.error("An address could not be located", error);
    return NO_LOCATION;
  }
}
