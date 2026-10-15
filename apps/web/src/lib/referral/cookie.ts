import { REFERRAL_PARAM, referrerOf } from "./link";

// How long the referral cookie lasts: thirty days from the visit that set it.
export const REFERRAL_MAX_AGE = 60 * 60 * 24 * 30;

export type ReferralStep = {
  // The member to remember, when the cookie is to be written.
  set: number | null;
  // The referral cookie is to be removed: it is there but the visitor no longer accepts it.
  clear: boolean;
};

// What a request does to the referral cookie, from its address and the cookies it came with.
// The cookie is written only for a page load of a guest with a valid `?ref=` once the visitor has
// accepted the referrals category, and never over a cookie already holding a valid referrer (the
// first one wins). A signed-in member has no use for it: they are already registered. A cookie the
// visitor has not accepted, or has since withdrawn, is removed here because it is HttpOnly and the
// banner's script cannot reach it. `accepted` is whether the visitor accepts referrals under the
// policy version the site has now; null when that is not known (the site could not be read), and
// then the cookie is neither written nor removed.
export function referralStep(
  url: URL,
  cookies: { referral?: string },
  pageLoad: boolean,
  signedIn: boolean,
  accepted: boolean | null,
): ReferralStep {
  if (accepted === null) return { set: null, clear: false };
  const referrer = referrerOf(url.searchParams.getAll(REFERRAL_PARAM));
  const held = referrerOf(cookies.referral) !== null;
  return {
    set: pageLoad && !signedIn && accepted && !held ? referrer : null,
    clear: cookies.referral !== undefined && !accepted,
  };
}
