import { consentBanner } from "@sermo/core/contracts";
import { callWith, type Forward } from "./transport";

// Whether the cookie banner applies to the visitor behind a request, as the backend decides from
// the site's setting and the country the trusted proxy reported (the location headers travel in
// `forward`). The session is not sent: the answer does not depend on it, and a dead cookie must not
// make the banner fail. When the backend cannot say the banner applies: asking too much is the safe
// mistake.
export async function bannerApplies(forward: Forward): Promise<boolean> {
  try {
    const { show } = await callWith(
      { ...forward, cookie: undefined },
      consentBanner,
      {},
    );
    return show;
  } catch {
    return true;
  }
}
