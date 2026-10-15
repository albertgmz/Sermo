import { existsSync, readFileSync } from "node:fs";
import type { GeoLookup } from "./config";

/**
 * Opens a MaxMind City or Country database (an .mmdb file) as a lookup. The file is optional:
 * with no path the answer is null and nothing is looked up (the library is not even loaded). A
 * path that does not point at a database is an error at start, so a typo does not silently turn
 * the feature off.
 */
export async function openGeoDatabase(path: string | null | undefined): Promise<GeoLookup | null> {
  if (!path) return null;
  if (!existsSync(path)) throw new Error(`The GeoIP database was not found: ${path}`);
  const { Reader } = await import("maxmind");
  const reader = new Reader<import("maxmind").CityResponse>(readFileSync(path));
  return (ip) => {
    const record = reader.get(ip);
    if (!record) return null;
    return {
      country: record.country?.iso_code ?? record.registered_country?.iso_code ?? null,
      region: record.subdivisions?.[0]?.names?.en ?? null,
      city: record.city?.names?.en ?? null,
    };
  };
}
