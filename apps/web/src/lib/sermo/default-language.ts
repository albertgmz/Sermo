import { siteGet } from "@sermo/core/contracts";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/locales";
import { callWith } from "./transport";

// The site's default language, for the visitor whose cookie and browser name no supported one. The
// proxy asks on such a request and must never wait on the backend for long, so the value lives in
// this module: fresh for a minute, then read again in the background while the last known value
// answers. Only the very first read is waited for, and only briefly. A failed read keeps the last
// known value (English before any) and is tried again after ten seconds. It cannot be a
// "use cache" function: the proxy is not a render.
const FRESH_MS = 60_000;
const RETRY_MS = 10_000;
const WAIT_MS = 1_500;
const GIVE_UP_MS = 10_000;

let known: Locale = DEFAULT_LOCALE;
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
      if (isLocale(site.defaultLanguage)) known = site.defaultLanguage;
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

export async function siteDefaultLanguage(now = Date.now()): Promise<Locale> {
  if (now < validUntil) return known;
  const read = refresh(now);
  // Before any read there is nothing better than English: wait a moment for the first answer.
  if (!everRead) await Promise.race([read, after(WAIT_MS)]);
  return known;
}

// For tests: forget what was read.
export function forgetDefaultLanguage() {
  known = DEFAULT_LOCALE;
  validUntil = 0;
  everRead = false;
  loading = null;
}
