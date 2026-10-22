import { NextResponse } from "next/server";
import { ACCOUNT_THEME_COOKIE } from "@/components/layout/theme";
import { forgetAdoptedConsent } from "@/lib/consent/sync";
import { signOut } from "@/lib/sermo/auth";
import { publicUrl } from "@/lib/sermo/config";
import { SermoError } from "@/lib/sermo/errors";

// What signing out asks the browser to drop for this site: its HTTP cache (the account's pages it
// kept) and its storage (drafts, the theme and other local settings, the offline files and the
// service worker), so a shared device keeps nothing of the member. Not "cookies": the sign-out
// already expires Better Auth's own, and that directive would also take every cookie of the
// registrable domain, other hosts under it included, and the visitor's own choices (language,
// cookie consent, Data saver).
const CLEAR_SITE_DATA = '"cache", "storage"';

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

// Signs the visitor out, from the forms of the avatar menu, the account screens and the terms gate.
// A route rather than an action, because only a route can send `Clear-Site-Data`; the answer sends
// the browser to the home page with a full load, so no page of the member stays in the router
// either. It sits outside the language segment, like the upload routes: the home page it sends the
// browser to is drawn in the visitor's language by the proxy, from the language cookie the
// sign-out keeps. A form posted from any other site is refused. When the backend could not sign
// the visitor out, nothing is cleared and the home page says so.
export async function POST(request: Request) {
  const site = new URL(publicUrl());
  if (request.headers.get("origin") !== site.origin)
    return new Response(null, { status: 403 });
  if (!(await endSession()))
    return NextResponse.redirect(new URL("/?notice=signOutFailed", site), 303);
  await forgetAdoptedConsent();
  const response = NextResponse.redirect(new URL("/", site), 303);
  // The member's theme travels in a cookie, which Clear-Site-Data above does not take.
  response.cookies.delete(ACCOUNT_THEME_COOKIE);
  response.headers.set("Clear-Site-Data", CLEAR_SITE_DATA);
  return response;
}
