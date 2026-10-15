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

// A visitor the site does not ask (the banner is for Europe only and they are elsewhere) who has
// chosen nothing is treated as having accepted every category, until they choose in the settings.
// Anyone who did choose keeps their choice.
export function withoutBanner(own: Consent): Consent {
  return own.decided ? own : { decided: false, accepted: OPTIONAL_CATEGORIES };
}

export const allows = (consent: Consent, category: OptionalCategory) =>
  consent.accepted.includes(category);

// A choice as the banner library's cookie records it: the optional categories accepted and when
// (epoch milliseconds, 0 when the cookie does not say).
export type Choice = { accepted: OptionalCategory[]; at: number };

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
  const { categories, revision, consentTimestamp, lastConsentTimestamp } =
    (record ?? {}) as Record<string, unknown>;
  if (revision !== version || !Array.isArray(categories)) return null;
  const at = Date.parse(String(lastConsentTimestamp ?? consentTimestamp));
  return {
    accepted: OPTIONAL_CATEGORIES.filter((category) =>
      categories.includes(category),
    ),
    at: Number.isNaN(at) ? 0 : at,
  };
}

// The consent of a visitor from their cookie value. Whether the banner applies to them is asked
// (`bannerApplies`) only for a visitor who has chosen nothing on a site whose banner is for
// Europe only.
export async function consentOf(
  value: string | undefined,
  site: SiteConsent,
  bannerApplies: () => Promise<boolean>,
): Promise<Consent> {
  const own = parseConsent(value, site.version);
  if (own.decided || site.bannerOutsideEu) return own;
  return (await bannerApplies()) ? own : withoutBanner(own);
}

export function parseConsent(
  value: string | undefined,
  version: number,
): Consent {
  const choice = parseChoice(value, version);
  return choice ? { decided: true, accepted: choice.accepted } : NO_CONSENT;
}

type Provider = z.output<typeof Analytics>;

// Matomo in its cookieless mode (a site setting) sets no cookie and is not held back for consent.
export const isCookielessMatomo = (analytics: Provider, cookieless: boolean) =>
  cookieless && analytics.provider === "matomo";

// The analytics scripts to put on a page: none until the visitor accepted analytics, and none
// again once they withdraw it; cookieless Matomo needs no choice.
export const analyticsFor = (
  consent: Consent,
  analytics: Provider,
  cookieless = false,
) => {
  if (isCookielessMatomo(analytics, cookieless))
    return analyticsSnippets(analytics, { cookieless: true });
  return allows(consent, "analytics") ? analyticsSnippets(analytics) : [];
};

// Whether the referral cookie may be set (item 2 asks this before writing it).
export const mayStoreReferral = (consent: Consent) =>
  allows(consent, "referrals");

// Whether a third-party player may be drawn on a page.
export const mayEmbed = (consent: Consent) => allows(consent, "embeds");
