/**
 * The countries whose visitors the cookie banner is always shown to when the site shows it only
 * where consent rules apply: the 27 EU members, the other EEA states (Iceland, Liechtenstein,
 * Norway), the United Kingdom and Switzerland. Upper-case ISO 3166-1 alpha-2 codes.
 */
export const CONSENT_REGION_COUNTRIES: ReadonlySet<string> = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
  "IS",
  "LI",
  "NO",
  "GB",
  "CH",
]);

export const inConsentRegion = (country: string): boolean =>
  CONSENT_REGION_COUNTRIES.has(country.toUpperCase());
