import { CONSENT_COOKIE } from "./inventory";
import { parseChoice, standsUnderGpc } from "./state";

// Whether the browser sends Global Privacy Control (`navigator.globalPrivacyControl`).
export const browserSendsGpc = (nav: Navigator) =>
  (nav as Navigator & { globalPrivacyControl?: unknown })
    .globalPrivacyControl === true;

// Run before the banner starts while the browser sends Global Privacy Control: takes off a consent
// cookie whose choice the signal overrides (an acceptance made before it, see `standsUnderGpc`), so
// the banner asks again with everything off, as the server already treats that visitor. It is
// cleared where the library may have written it: for the host when the host has a dot, and as a
// host-only cookie. True when it was taken off.
export function forgetChoiceOverriddenByGpc(
  doc: { cookie: string },
  hostname: string,
  version: number,
): boolean {
  const pair = doc.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${CONSENT_COOKIE}=`));
  const choice = parseChoice(pair?.slice(CONSENT_COOKIE.length + 1), version);
  if (!choice || standsUnderGpc(choice)) return false;
  const gone = `${CONSENT_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
  doc.cookie = gone;
  if (hostname.includes(".")) doc.cookie = `${gone}; Domain=${hostname}`;
  return true;
}
