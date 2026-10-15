import { siteGet } from "@sermo/core/contracts";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/locales";
import { callWith } from "./transport";

// The few facts about the site the proxy needs on a request: the site's default language, for the
// visitor whose cookie and browser name no supported one, and the cookie policy version and banner
// setting, for a request that carries a referral. The proxy must never wait on the backend for
// long, so the values live in this module: fresh for a minute, then read again in the background
// while the last known values answer. Only the very first read is waited for, and only briefly. A
// failed read keeps the last known values (English, no version and the banner for everyone before
// any) and is tried again after ten seconds. It cannot be a "use cache" function: the proxy is not
// a render.
const FRESH_MS = 60_000;
const RETRY_MS = 10_000;
const WAIT_MS = 1_500;
const GIVE_UP_MS = 10_000;

export type SiteFacts = {
  language: Locale;
  // The cookie policy version in force; null until the site has been read once.
  cookiePolicyVersion: number | null;
  // Whether the cookie banner is shown to visitors outside Europe too.
  bannerOutsideEu: boolean;
};

const UNKNOWN: SiteFacts = {
  language: DEFAULT_LOCALE,
  cookiePolicyVersion: null,
  bannerOutsideEu: true,
};

let known: SiteFacts = UNKNOWN;
let validUntil = 0;
let everRead = false;
let loading: Promise<void> | null = null;

const after = (ms: number) =>
  new Promise<"late">((resolve) => setTimeout(() => resolve("late"), ms));

function refresh(now: number) {
  if (loading) return loading;
  const read = (async () => {
    try {
      const site = await Promise.race([
        callWith({}, siteGet, {}),
        after(GIVE_UP_MS),
      ]);
      if (site === "late") throw new Error("The site read timed out.");
      known = {
        language: isLocale(site.defaultLanguage)
          ? site.defaultLanguage
          : known.language,
        cookiePolicyVersion: site.cookiePolicyVersion,
        bannerOutsideEu: site.cookieBannerOutsideEu,
      };
      everRead = true;
      validUntil = now + FRESH_MS;
    } catch {
      validUntil = now + RETRY_MS;
    } finally {
      loading = null;
    }
  })();
  loading = read;
  return read;
}

async function facts(now: number): Promise<SiteFacts> {
  if (now < validUntil) return known;
  const read = refresh(now);
  // Before any read there is nothing better than the unknowns: wait a moment for the first answer.
  if (!everRead) await Promise.race([read, after(WAIT_MS)]);
  return known;
}

export async function siteDefaultLanguage(now = Date.now()): Promise<Locale> {
  return (await facts(now)).language;
}

// What the proxy knows about the cookie policy: a change made by an administrator reaches it within
// a minute.
export async function siteConsentFacts(
  now = Date.now(),
): Promise<Pick<SiteFacts, "cookiePolicyVersion" | "bannerOutsideEu">> {
  const { cookiePolicyVersion, bannerOutsideEu } = await facts(now);
  return { cookiePolicyVersion, bannerOutsideEu };
}

// For tests: forget what was read.
export function forgetDefaultLanguage() {
  known = UNKNOWN;
  validUntil = 0;
  everRead = false;
  loading = null;
}
