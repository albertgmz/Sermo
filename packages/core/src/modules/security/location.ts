import type { ClientLocation } from "../../actor";

/**
 * Headers the HTTP adapter sets from the location the proxy reported (Cloudflare's "Add visitor
 * location headers" managed transform), after deleting any value the client sent. They carry
 * percent-encoded text so any city name travels as a header. Only the adapter writes them; the
 * services read nothing else.
 */
export const LOCATION_HEADERS = {
  country: "x-sermo-client-country",
  region: "x-sermo-client-region",
  city: "x-sermo-client-city",
} as const;

/** The proxy's own headers, which the adapter trusts only when told the proxy is in front. */
export const PROXY_LOCATION_HEADERS = {
  country: "cf-ipcountry",
  region: "cf-region",
  city: "cf-ipcity",
} as const;

export const NO_LOCATION: ClientLocation = Object.freeze({
  country: null,
  region: null,
  city: null,
});

const MAX_PART = 100;
// Cloudflare reports XX for an unknown country and T1 for Tor.
const NOT_A_COUNTRY = new Set(["XX", "T1"]);

export function cleanCountry(raw: string | null | undefined): string | null {
  const code = raw?.trim().toUpperCase();
  return code && /^[A-Z]{2}$/.test(code) && !NOT_A_COUNTRY.has(code) ? code : null;
}

/**
 * A place name from a header or a database: control characters out, cut to a sane length, and
 * text that a proxy sent as UTF-8 but a server read as Latin-1 put back.
 */
export function cleanPlace(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let text = raw;
  const codes = Array.from(text, (char) => char.charCodeAt(0));
  if (codes.some((code) => code > 0x7f) && codes.every((code) => code <= 0xff)) {
    const repaired = Buffer.from(text, "latin1").toString("utf8");
    if (!repaired.includes(String.fromCharCode(0xfffd))) text = repaired;
  }
  const clean = Array.from(text)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code > 0x1f && code !== 0x7f;
    })
    .join("")
    .trim()
    .slice(0, MAX_PART);
  return clean || null;
}

function decoded(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (!raw.includes("%")) return raw;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function located(location: ClientLocation): ClientLocation | null {
  return location.country || location.region || location.city ? location : null;
}

/** What the proxy reported for the request, cleaned; null when it reported nothing usable. */
export function proxyLocation(headers: Headers): ClientLocation | null {
  return located({
    country: cleanCountry(headers.get(PROXY_LOCATION_HEADERS.country)),
    region: cleanPlace(decoded(headers.get(PROXY_LOCATION_HEADERS.region))),
    city: cleanPlace(decoded(headers.get(PROXY_LOCATION_HEADERS.city))),
  });
}

/** Puts a location on the request headers for the services (replacing whatever was there). */
export function setLocationHeaders(headers: Headers, location: ClientLocation | null): void {
  for (const name of Object.values(LOCATION_HEADERS)) headers.delete(name);
  if (!location) return;
  for (const part of ["country", "region", "city"] as const) {
    const value = location[part];
    if (value) headers.set(LOCATION_HEADERS[part], encodeURIComponent(value));
  }
}

/** The location the adapter set on a request; null when it set none. */
export function requestLocation(headers: Headers | null | undefined): ClientLocation | null {
  if (!headers) return null;
  return located({
    country: cleanCountry(headers.get(LOCATION_HEADERS.country)),
    region: cleanPlace(decoded(headers.get(LOCATION_HEADERS.region))),
    city: cleanPlace(decoded(headers.get(LOCATION_HEADERS.city))),
  });
}
