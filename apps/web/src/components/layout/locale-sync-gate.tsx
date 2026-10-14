import { getLocale } from "next-intl/server";
import { LocaleSync } from "@/components/layout/locale-sync";
import { isLocale } from "@/i18n/locales";
import { getViewer } from "@/lib/sermo/session";

// Draws `LocaleSync` for a member whose saved language is one the site speaks and is not the one
// this page is in. The viewer is the request's one `auth.me` read, shared with the rest of the page.
export async function LocaleSyncGate() {
  const [viewer, locale] = await Promise.all([getViewer(), getLocale()]);
  const language = viewer.user?.language;
  if (!isLocale(language) || language === locale) return null;
  return <LocaleSync language={language} />;
}
