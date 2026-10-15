import {
  CATEGORIES,
  OPTIONAL_CATEGORIES,
  type OptionalCategory,
} from "./inventory";
import type { Choice } from "./state";

// A member's choice as the backend keeps it on their account (`consent.mine`).
export type AccountRecord = {
  categories: readonly OptionalCategory[];
  policyVersion: number;
  decidedAt: string;
};

// What to do at sign-in with the choice this browser holds (null when it holds none for the policy
// version in force) and the member's record:
// - "save": the browser's choice goes to the account (the account has none for this version, or
//   the browser's is the later of two that differ);
// - "adopt": the browser takes the account's choice (it holds none, or the account's is the later);
// - "none": nothing to do.
// A record of another version than the current one is no choice, as in the browser.
export type Reconciled = "save" | "adopt" | "none";

const sameCategories = (
  a: readonly OptionalCategory[],
  b: readonly OptionalCategory[],
) => OPTIONAL_CATEGORIES.every((c) => a.includes(c) === b.includes(c));

export function reconcile(
  device: Choice | null,
  record: AccountRecord | null,
  version: number,
): Reconciled {
  const held = record?.policyVersion === version ? record : null;
  if (device === null) return held ? "adopt" : "none";
  if (held === null) return "save";
  if (sameCategories(device.accepted, held.categories)) return "none";
  return device.at > Date.parse(held.decidedAt) ? "save" : "adopt";
}

// How long the banner library keeps its cookie.
export const CONSENT_COOKIE_DAYS = 182;

// The text of the library's cookie for a choice made elsewhere, in the shape the library reads back
// (`categories`, `revision`, a consent id and the times). It is the JSON itself: setting the cookie
// URL-encodes it, as the library does when it writes its own.
export function consentCookieValue(
  record: AccountRecord,
  language: string,
  consentId: string,
): string {
  const categories = ["necessary", ...record.categories];
  return JSON.stringify({
    categories,
    revision: record.policyVersion,
    data: null,
    consentTimestamp: record.decidedAt,
    consentId,
    services: Object.fromEntries(CATEGORIES.map((name) => [name, []])),
    languageCode: language,
    lastConsentTimestamp: record.decidedAt,
  });
}
