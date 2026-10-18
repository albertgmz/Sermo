import "server-only";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { bannerApplies } from "@/lib/sermo/banner";
import { forwardFromRequest } from "@/lib/sermo/client";
import { getSite } from "@/lib/sermo/site";
import { sermoCookies } from "@/lib/sermo/transport";
import { CONSENT_COOKIE } from "./inventory";
import { type Consent, consentOf, sendsGpc } from "./state";

// The visitor's consent on this request, asked once. Reading the cookie makes the page dynamic,
// like every other read of a visitor's cookie. A visitor who has chosen nothing and whom the site
// does not ask (its banner is for Europe only) is treated as having accepted; the backend is
// asked about that only when the site is set that way. A request with Global Privacy Control
// (`Sec-GPC: 1`) has nothing optional on unless the visitor chose so after the signal.
export const getConsent = cache(async (): Promise<Consent> => {
  const [store, site, forward, request] = await Promise.all([
    cookies(),
    getSite(),
    forwardFromRequest(),
    headers(),
  ]);
  return consentOf(
    store.get(CONSENT_COOKIE)?.value,
    {
      version: site.cookiePolicyVersion,
      bannerOutsideEu: site.cookieBannerOutsideEu,
    },
    sermoCookies(forward.cookie) !== "",
    () => bannerApplies(forward),
    sendsGpc(request),
  );
});
