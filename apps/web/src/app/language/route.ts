import { preferencesUpdate } from "@sermo/core/contracts";
import { NextResponse } from "next/server";
import { LANGUAGE_SWITCHER_ID } from "@/components/layout/language-switcher";
import { LOCALE_COOKIE, SYSTEM_LANGUAGE } from "@/i18n/locale-cookie";
import { isLocale, type Locale } from "@/i18n/locales";
import { writeLocaleCookie } from "@/i18n/write-locale-cookie";
import { call, unconfirmedKind } from "@/lib/sermo/client";
import { publicUrl } from "@/lib/sermo/config";
import { SermoError } from "@/lib/sermo/errors";
import { pageOfRequest } from "@/lib/sermo/request-page";
import { getViewer } from "@/lib/sermo/session";

// Whether the choice may be kept in the cookie. A guest's choice is the cookie. A member's is the
// language saved on their account, which every browser they sign in on follows (`LocaleSync`), so
// it is saved there first: a cookie alone would be put back to the saved language on the next
// page. When the backend cannot say who is asking, or does not save it, nothing changes.
async function kept(language: Locale | null) {
  if ((await getViewer()).user) {
    try {
      await call(preferencesUpdate, { language });
      return true;
    } catch (error) {
      if (error instanceof SermoError) return false;
      throw error;
    }
  }
  return (await unconfirmedKind()) !== "session";
}

// "System" is no language: it removes the cookie (and a member's saved language), so the site's
// default decides again.
// Switches the interface language, from the language chooser in the footer. A route rather than
// an action, so the plain form works before any script has run and the page that follows is a full
// load in the new language (a soft navigation into another root layout leaves the old page in the
// document). It sits outside the language segment, like the sign-out route. The browser goes back
// to the address it came from (its Referer, when that is a path of this site; else the home page),
// which the proxy draws in the language of the cookie, scrolled to the switcher: a Referer carries
// no fragment and a load after a POST starts at the top, which would leave a reader at the foot of
// a long thread at its head. A form posted from any other site is refused.
export async function POST(request: Request) {
  const site = new URL(publicUrl());
  if (request.headers.get("origin") !== site.origin)
    return new Response(null, { status: 403 });
  const form = await request.formData().catch(() => undefined);
  const chosen = form?.get("language");
  if (chosen !== SYSTEM_LANGUAGE && !isLocale(chosen))
    return new Response(null, { status: 400 });
  const language = isLocale(chosen) ? chosen : null;
  const back = new URL(await pageOfRequest(), site);
  back.hash = LANGUAGE_SWITCHER_ID;
  const response = NextResponse.redirect(back, 303);
  if (await kept(language)) {
    if (language) writeLocaleCookie(response.cookies, language);
    else response.cookies.delete(LOCALE_COOKIE);
  }
  return response;
}
