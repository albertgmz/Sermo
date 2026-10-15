import { consentBanner } from "@sermo/core/contracts";
import { callWith, type Forward } from "./transport";

// Whether the cookie banner applies to the visitor behind a request, as the backend decides from
// the site's setting and the country the trusted proxy reported (the location headers travel in
// `forward`). The session is not sent: the answer does not depend on it, and a dead cookie must not
// make the banner fail.
//
// The answer depends on the country alone, so it is kept for a minute per country code (at most
// one entry for each possible code; whatever else a header holds counts as no country) instead of
// asked on every request: the proxy and every render of a page ask. A failure, or no answer in a
// couple of seconds, is unknown and is tried again after ten seconds.
const FRESH_MS = 60_000;
const RETRY_MS = 10_000;
const WAIT_MS = 2_000;

const known = new Map<string, { show: boolean | null; until: number }>();

const countryOf = (forward: Forward) => {
  const code = forward.location?.["cf-ipcountry"]?.trim().toUpperCase();
  return code && /^[A-Z]{2}$/.test(code) ? code : "";
};

// True or false when the backend said; null when it could not.
export async function bannerAppliesOrUnknown(
  forward: Forward,
  now = Date.now(),
): Promise<boolean | null> {
  const key = countryOf(forward);
  const held = known.get(key);
  if (held && now < held.until) return held.show;
  let show: boolean | null = null;
  try {
    const answer = await Promise.race([
      callWith({ ...forward, cookie: undefined }, consentBanner, {}),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), WAIT_MS)),
    ]);
    show = answer === null ? null : answer.show;
  } catch {
    show = null;
  }
  known.set(key, { show, until: now + (show === null ? RETRY_MS : FRESH_MS) });
  return show;
}

// When the backend cannot say the banner applies: asking too much is the safe mistake.
export async function bannerApplies(forward: Forward): Promise<boolean> {
  return (await bannerAppliesOrUnknown(forward)) ?? true;
}

// For tests: forget what was kept.
export function forgetBanner() {
  known.clear();
}
