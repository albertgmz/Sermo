import { POLICY_VERSION } from "@/lib/consent/inventory";
import { mayStoreReferral, parseConsent } from "@/lib/consent/state";
import { REFERRAL_PARAM, referrerOf } from "./link";

// How long the referral cookie lasts: thirty days from the visit that set it.
export const REFERRAL_MAX_AGE = 60 * 60 * 24 * 30;

export type ReferralStep = {
  // The member to remember, when the cookie is to be written.
  set: number | null;
  // The referral cookie is to be removed: it is there but the visitor no longer accepts it.
  clear: boolean;
  // The address of the page without `ref`, when the request carried one.
  canonical: string | null;
};

// What a request does to the referral cookie, from its address and the cookies it came with.
// The cookie is written only for a page load with a valid `?ref=` once the visitor has accepted
// the referrals category, and never over a cookie already holding a valid referrer (the first one
// wins). A cookie the visitor has not accepted, or has since withdrawn, is removed here because
// it is HttpOnly and the banner's script cannot reach it. `consentCookie` is read against the
// policy version of the web app: `site.get` does not carry another one yet.
export function referralStep(
  url: URL,
  cookies: { referral?: string; consent?: string },
  pageLoad: boolean,
  origin: string,
): ReferralStep {
  const accepted = mayStoreReferral(
    parseConsent(cookies.consent, POLICY_VERSION),
  );
  const referrer = referrerOf(url.searchParams.getAll(REFERRAL_PARAM));
  const held = referrerOf(cookies.referral) !== null;
  let canonical: string | null = null;
  if (url.searchParams.has(REFERRAL_PARAM)) {
    // Built from the origin, never from the path alone: a path starting with // would name a host.
    const plain = new URL(origin);
    plain.pathname = url.pathname.replace(/^\/{2,}/, "/");
    plain.search = url.search;
    plain.searchParams.delete(REFERRAL_PARAM);
    canonical = plain.href;
  }
  return {
    set: pageLoad && accepted && !held ? referrer : null,
    clear: cookies.referral !== undefined && !accepted,
    canonical,
  };
}
