import type { Analytics } from "@sermo/core/contracts";
import type * as z from "zod";
import { analyticsSnippets } from "@/components/layout/analytics-snippets";
import {
  OPTIONAL_CATEGORIES,
  type OptionalCategory,
  POLICY_VERSION,
} from "./inventory";

// What a visitor has chosen. `decided` is false until a choice is recorded against the current
// policy version; an older choice counts as none, so the banner asks again.
export type Consent = {
  decided: boolean;
  accepted: readonly OptionalCategory[];
};

export const NO_CONSENT: Consent = { decided: false, accepted: [] };

export const allows = (consent: Consent, category: OptionalCategory) =>
  consent.accepted.includes(category);

// The policy version in force: a positive whole number `cookiePolicyVersion` on the site wins,
// else the constant. `getSite` fills it from the `site.get` answer once that contract names the
// field (part 2); until then every site reads the constant.
export function policyVersion(site: object): number {
  const version = (site as { cookiePolicyVersion?: unknown })
    .cookiePolicyVersion;
  return typeof version === "number" && Number.isInteger(version) && version > 0
    ? version
    : POLICY_VERSION;
}

// The consent a cookie value records, as written by the banner library: URL-encoded JSON holding
// the accepted categories and the policy version (`revision`). Anything else is no choice.
export function parseConsent(
  value: string | undefined,
  version: number,
): Consent {
  if (!value) return NO_CONSENT;
  let record: unknown;
  try {
    record = JSON.parse(decodeURIComponent(value));
  } catch {
    return NO_CONSENT;
  }
  const { categories, revision } = (record ?? {}) as {
    categories?: unknown;
    revision?: unknown;
  };
  if (revision !== version || !Array.isArray(categories)) return NO_CONSENT;
  return {
    decided: true,
    accepted: OPTIONAL_CATEGORIES.filter((category) =>
      categories.includes(category),
    ),
  };
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
