import { cookiesOf } from "./config";
import { CONSENT_COOKIE, OPTIONAL_CATEGORIES } from "./inventory";
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

// After `forgetChoiceOverriddenByGpc` took a choice off: the cookies of every optional category go
// too, as on any withdrawal (the library clears them only when a choice is saved), so what the
// cookie policy says holds. `erase` is the library's `eraseCookies`; each cookie is erased where
// the library's own clearing looks for it (`cookiesOf`).
export function eraseOptionalCookies(
  erase: (name: string | RegExp, path: string, domain?: string) => void,
  hostname: string,
) {
  for (const category of OPTIONAL_CATEGORIES)
    for (const { name, domain } of cookiesOf(category, hostname) as {
      name: string | RegExp;
      domain?: string;
    }[])
      erase(name, "/", domain);
}
