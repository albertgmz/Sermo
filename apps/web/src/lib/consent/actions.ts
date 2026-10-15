"use server";

import { consentSave } from "@sermo/core/contracts";
import { cookies } from "next/headers";
import { forwardFromRequest } from "@/lib/sermo/client";
import { getSite } from "@/lib/sermo/site";
import { callWith, sermoCookies } from "@/lib/sermo/transport";
import { CONSENT_COOKIE } from "./inventory";
import { parseChoice } from "./state";

// Saves on the account the choice the banner has just stored in this browser. Called by the banner
// after every choice; a guest has no account and nothing happens. The choice is read from the
// consent cookie the request carries, not from an argument, so the record is exactly what the
// banner wrote, and only when it answers the policy version in force. A failure is left for the
// next choice: the cookie is the choice, the record only follows it.
export async function saveConsentChoice(): Promise<void> {
  const forward = await forwardFromRequest();
  if (!sermoCookies(forward.cookie)) return;
  try {
    const [store, site] = await Promise.all([cookies(), getSite()]);
    const version = site.cookiePolicyVersion;
    const choice = parseChoice(store.get(CONSENT_COOKIE)?.value, version);
    if (choice === null) return;
    await callWith(forward, consentSave, {
      categories: choice.accepted,
      policyVersion: version,
    });
  } catch (error) {
    console.error("The cookie choice could not be saved on the account", error);
  }
}
