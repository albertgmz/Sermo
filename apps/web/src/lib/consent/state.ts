import type { Analytics } from "@sermo/core/contracts";
import type * as z from "zod";
import { analyticsSnippets } from "@/components/layout/analytics-snippets";
import { OPTIONAL_CATEGORIES, type OptionalCategory } from "./inventory";

// What a visitor has chosen. `decided` is false until a choice is recorded against the current
// policy version; an older choice counts as none, so the banner asks again.
export type Consent = {
  decided: boolean;
  accepted: readonly OptionalCategory[];
};

export const NO_CONSENT: Consent = { decided: false, accepted: [] };

// What the site says about asking: the policy version in force and whether the banner is shown
// outside Europe too.
export type SiteConsent = { version: number; bannerOutsideEu: boolean };

// A visitor the site does not ask (see `isUnasked`) is treated as having accepted every category,
// until they choose in the settings. Anyone who did choose keeps their choice.
export function withoutBanner(own: Consent): Consent {
  return own.decided ? own : { decided: false, accepted: OPTIONAL_CATEGORIES };
}

export const allows = (consent: Consent, category: OptionalCategory) =>
  consent.accepted.includes(category);

// A choice as the banner library's cookie records it: the optional categories accepted, when
// (epoch milliseconds, 0 when the cookie does not say) and whether it was made while the browser
// sent Global Privacy Control (`GPC_MARK` in the library's `data` field).
export type Choice = { accepted: OptionalCategory[]; at: number; gpc: boolean };

// What the banner adds to the library's `data` field when a choice is made while the browser sends
// Global Privacy Control: that choice came after the signal, so it stands under it.
export const GPC_MARK = { gpc: true } as const;

// Whether a request carries Global Privacy Control (`Sec-GPC: 1`).
export const sendsGpc = (headers: { get(name: string): string | null }) =>
  headers.get("sec-gpc")?.trim() === "1";

// Whether a choice stands while the browser sends Global Privacy Control: one made with the signal
// on (the visitor opted in after it), or one that accepts nothing optional anyway. Any other is an
// earlier acceptance the signal overrides: it counts as no choice, nothing optional runs and the
// banner asks again.
export const standsUnderGpc = (choice: Choice) =>
  choice.gpc || choice.accepted.length === 0;

// The choice a cookie value records against the policy version in force, or null: the value is
// URL-encoded JSON holding the accepted categories, the policy version (`revision`) and the time
// of the latest change. Anything else, or a choice of another version, is no choice.
export function parseChoice(
  value: string | undefined,
  version: number,
): Choice | null {
  if (!value) return null;
  let record: unknown;
  try {
    record = JSON.parse(decodeURIComponent(value));
  } catch {
    return null;
  }
  const { categories, revision, consentTimestamp, lastConsentTimestamp, data } =
    (record ?? {}) as Record<string, unknown>;
  if (revision !== version || !Array.isArray(categories)) return null;
  const at = Date.parse(String(lastConsentTimestamp ?? consentTimestamp));
  return {
    accepted: OPTIONAL_CATEGORIES.filter((category) =>
      categories.includes(category),
    ),
    at: Number.isNaN(at) ? 0 : at,
    gpc: (data as { gpc?: unknown } | null | undefined)?.gpc === true,
  };
}

// Whether the cookie value holds a choice of another policy version than the one in force. Such a
// visitor has answered the banner before: a version bump asks them again, and until they answer
// nothing optional runs, whatever their country.
export function hasEarlierChoice(
  value: string | undefined,
  version: number,
): boolean {
  if (!value) return false;
  try {
    const { categories, revision } = JSON.parse(decodeURIComponent(value));
    return Array.isArray(categories) && revision !== version;
  } catch {
    return false;
  }
}

// Whether the site does not ask this visitor: its banner is for Europe only, the visitor is a guest
// who never answered it (under any policy version) and the backend says the banner does not apply
// to them. Anyone who answered once, and anyone signed in, is asked, so a refusal is never turned
// into an acceptance. The backend is asked only when everything else says "unasked".
export async function isUnasked(
  value: string | undefined,
  site: SiteConsent,
  signedIn: boolean,
  bannerApplies: () => Promise<boolean>,
): Promise<boolean> {
  if (site.bannerOutsideEu || signedIn) return false;
  if (parseChoice(value, site.version) || hasEarlierChoice(value, site.version))
    return false;
  return !(await bannerApplies());
}

// The consent of a visitor from their cookie value. `gpc`: the request carries Global Privacy
// Control, which is the visitor's answer until they choose otherwise after it: nothing optional
// runs, whether or not the site asks them.
export async function consentOf(
  value: string | undefined,
  site: SiteConsent,
  signedIn: boolean,
  bannerApplies: () => Promise<boolean>,
  gpc = false,
): Promise<Consent> {
  const own = parseConsent(value, site.version, gpc);
  if (own.decided || gpc) return own;
  return (await isUnasked(value, site, signedIn, bannerApplies))
    ? withoutBanner(own)
    : own;
}

export function parseConsent(
  value: string | undefined,
  version: number,
  gpc = false,
): Consent {
  const choice = parseChoice(value, version);
  return choice && (!gpc || standsUnderGpc(choice))
    ? { decided: true, accepted: choice.accepted }
    : NO_CONSENT;
}

type Provider = z.output<typeof Analytics>;

// The analytics scripts to put on a page: none until the visitor accepted analytics, and none
// again once they withdraw it.
export const analyticsFor = (consent: Consent, analytics: Provider) =>
  allows(consent, "analytics") ? analyticsSnippets(analytics) : [];

// Whether the referral cookie may be set (item 2 asks this before writing it).
export const mayStoreReferral = (consent: Consent) =>
  allows(consent, "referrals");

// Whether a third-party player may be drawn on a page.
export const mayEmbed = (consent: Consent) => allows(consent, "embeds");
