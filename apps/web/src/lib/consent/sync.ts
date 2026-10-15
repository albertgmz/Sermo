import "server-only";
import { consentMine, consentSave } from "@sermo/core/contracts";
import { cookies } from "next/headers";
import { getLocale } from "next-intl/server";
import { forwardFromRequest } from "@/lib/sermo/client";
import { publicUrl } from "@/lib/sermo/config";
import { getSite } from "@/lib/sermo/site";
import { callWith } from "@/lib/sermo/transport";
import {
  CONSENT_COOKIE_DAYS,
  cameFromAccount,
  consentCookieValue,
  reconcile,
} from "./account";
import { CONSENT_COOKIE } from "./inventory";
import { parseChoice } from "./state";

// Brings the browser's cookie choice and the member's saved one together right after a sign-in
// (`sessionCookie` is the Cookie header of the session the answer opened). The sign-in is the
// moment a choice made as a guest can first be saved on the account, and the moment a device the
// member has not used before can take the choice they saved elsewhere, so the banner does not ask
// again. It never fails the sign-in: whatever goes wrong here is left for the next choice. True
// when the browser took the account's choice: the banner already running in this page knows
// nothing of it, so the caller must make the next page a full load.
export async function syncConsentAfterSignIn(
  sessionCookie: string,
): Promise<boolean> {
  try {
    const [store, site, forward] = await Promise.all([
      cookies(),
      getSite(),
      forwardFromRequest(),
    ]);
    const version = site.cookiePolicyVersion;
    const as = { ...forward, cookie: sessionCookie };
    const { record } = await callWith(as, consentMine, {});
    const device = parseChoice(store.get(CONSENT_COOKIE)?.value, version);
    const step = reconcile(device, record, version);
    if (step === "save" && device) {
      await callWith(as, consentSave, {
        categories: device.accepted,
        policyVersion: version,
        // When the visitor chose, not when they signed in.
        ...(device.at > 0
          ? { decidedAt: new Date(device.at).toISOString() }
          : {}),
      });
    } else if (step === "adopt" && record) {
      const host = new URL(publicUrl()).hostname;
      store.set({
        name: CONSENT_COOKIE,
        value: consentCookieValue(
          record,
          await getLocale(),
          crypto.randomUUID(),
        ),
        path: "/",
        // The library writes its cookie for the host it runs on whenever the host has a dot; a
        // host-only copy would sit beside it as a second cookie of the same name.
        ...(host.includes(".") ? { domain: host } : {}),
        maxAge: CONSENT_COOKIE_DAYS * 24 * 60 * 60,
        sameSite: "lax",
        secure: publicUrl().startsWith("https:"),
      });
      return true;
    }
  } catch (error) {
    console.error("The cookie choice could not be brought up to date", error);
  }
  return false;
}

// At sign-out: a consent cookie that was written from the account goes with the session, so the
// next person on a shared browser is asked. A choice made in this browser stays.
export async function forgetAdoptedConsent() {
  const store = await cookies();
  if (!cameFromAccount(store.get(CONSENT_COOKIE)?.value)) return;
  const host = new URL(publicUrl()).hostname;
  store.delete({
    name: CONSENT_COOKIE,
    path: "/",
    ...(host.includes(".") ? { domain: host } : {}),
  });
}
