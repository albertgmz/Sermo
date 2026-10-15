import "server-only";
import { cookies } from "next/headers";
import { getSite } from "@/lib/sermo/site";
import { CONSENT_COOKIE } from "./inventory";
import { type Consent, parseConsent, policyVersion } from "./state";

// The visitor's consent on this request. Reading the cookie makes the page dynamic, like every
// other read of a visitor's cookie.
export async function getConsent(): Promise<Consent> {
  const [store, site] = await Promise.all([cookies(), getSite()]);
  return parseConsent(store.get(CONSENT_COOKIE)?.value, policyVersion(site));
}
