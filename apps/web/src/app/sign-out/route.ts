import { NextResponse } from "next/server";
import { ACCOUNT_THEME_COOKIE } from "@/components/layout/theme";
import { forgetAdoptedConsent } from "@/lib/consent/sync";
import { signOut } from "@/lib/sermo/auth";
import { publicUrl, secureCookies } from "@/lib/sermo/config";
import { SermoError } from "@/lib/sermo/errors";
import { SIGNED_OUT_COOKIE, SIGNED_OUT_COOKIE_OPTIONS } from "@/lib/signed-out";

// What signing out asks the browser to drop for this site: its HTTP cache (the account's pages it
// kept). The storage (drafts, the theme and other local settings) is cleared by the first page
// after the sign-out (lib/signed-out.ts). Not "storage" here: it also removes the service worker of
// the page that is open, and an installed app can then stop on the sign-out and show nothing. Not
// "cookies": the sign-out already expires Better Auth's own, and that directive would also take
// every cookie of the registrable domain, other hosts under it included, and the visitor's own
// choices (language, cookie consent, Data saver).
const CLEAR_SITE_DATA = '"cache"';

// Whether the form was sent from a page of the site. The usual proof is an Origin equal to the
// site's address. An installed app can send "null" or no Origin, and a page at another address of
// the site (a `www.` host) sends that address. For those the browser's `Sec-Fetch-Site` decides:
// only "same-origin" is the site itself, and no page of another site can send it. A browser that
// sends neither proof is refused.
function sentFromSite(request: Request, site: URL) {
  if (request.headers.get("origin") === site.origin) return true;
  return request.headers.get("sec-fetch-site") === "same-origin";
}

// Whether the backend ended the session and expired its cookies: a sign-out it took, or the 401 of
// a session that was already gone (that answer expires the dead cookies too). An outage, a rate
// limit or any other refusal leaves the visitor signed in.
async function endSession() {
  try {
    const result = await signOut();
    return result.ok || result.code === "UNAUTHORIZED";
  } catch (error) {
    if (error instanceof SermoError) return false;
    throw error;
  }
}

// A full load of a page at the address the form was sent from. The address is relative, so the
// browser stays on its own origin and in the scope of an installed app, and the clean-up runs on
// the host that set its cookie.
const goTo = (path: string) =>
  new NextResponse(null, { status: 303, headers: { Location: path } });

const FAILED = "/?notice=signOutFailed";

// Signs the visitor out, from the forms of the avatar menu, the account screens and the terms gate.
// A route rather than an action, because only a route can send `Clear-Site-Data`; the answer sends
// the browser to the home page with a full load, so no page of the member stays in the router
// either. It sits outside the language segment, like the upload routes: the home page it sends the
// browser to is drawn in the visitor's language by the proxy, from the language cookie the
// sign-out keeps. A form posted from any other site, or a sign-out the backend could not make,
// clears nothing and lands on the home page, which says so. An installed app then shows a page,
// not an empty refusal.
export async function POST(request: Request) {
  const site = new URL(publicUrl());
  if (!sentFromSite(request, site) || !(await endSession()))
    return goTo(FAILED);
  await forgetAdoptedConsent();
  const response = goTo("/");
  // The member's theme travels in a cookie, which Clear-Site-Data above does not take.
  response.cookies.delete(ACCOUNT_THEME_COOKIE);
  response.cookies.set(SIGNED_OUT_COOKIE, "1", {
    ...SIGNED_OUT_COOKIE_OPTIONS,
    secure: secureCookies(),
  });
  response.headers.set("Clear-Site-Data", CLEAR_SITE_DATA);
  return response;
}
