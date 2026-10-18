import { NextResponse } from "next/server";
import { forgetAdoptedConsent } from "@/lib/consent/sync";
import { signOut } from "@/lib/sermo/auth";
import { publicUrl } from "@/lib/sermo/config";

// What signing out asks the browser to drop for this site: its HTTP cache (the account's pages it
// kept) and its storage (drafts, the theme and other local settings, the offline files and the
// service worker), so a shared device keeps nothing of the member. Not "cookies": the sign-out
// already expires Better Auth's own, and that directive would also take every cookie of the
// registrable domain, other hosts under it included, and the visitor's own choices (language,
// cookie consent, Data saver).
const CLEAR_SITE_DATA = '"cache", "storage"';

// Signs the visitor out, from the forms of the avatar menu, the account screens and the terms gate.
// A route rather than an action, because only a route can send `Clear-Site-Data`; the answer sends
// the browser to the home page with a full load, so no page of the member stays in the router
// either. A form posted from any other site is refused.
export async function POST(request: Request) {
  const site = new URL(publicUrl());
  if (request.headers.get("origin") !== site.origin)
    return new Response(null, { status: 403 });
  await signOut();
  await forgetAdoptedConsent();
  const response = NextResponse.redirect(new URL("/", site), 303);
  response.headers.set("Clear-Site-Data", CLEAR_SITE_DATA);
  return response;
}
