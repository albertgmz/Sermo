import { useTranslations } from "next-intl";
import { LanguageSelect } from "@/components/layout/language-select";
import { LOCALES } from "@/i18n/locales";
import { languageName } from "@/lib/language-name";

// The switcher's element id: the route sends the browser back to it, so the page loads again
// scrolled to the control the reader used (and the next Tab starts there), not at its top.
export const LANGUAGE_SWITCHER_ID = "language";

// A plain form, so it works before any script has run (a button shows only then): the `/language`
// route keeps the choice and loads this same address again.
export function LanguageSwitcher() {
  const t = useTranslations("layout.languageSwitcher");
  return (
    <form id={LANGUAGE_SWITCHER_ID} method="post" action="/language">
      <LanguageSelect
        languages={LOCALES.map((code) => ({
          code,
          name: languageName(code),
        }))}
      />
      <noscript>
        <button
          type="submit"
          className="ml-1.5 min-h-10 rounded-md border px-2.5 text-sm font-medium md:min-h-8"
        >
          {t("apply")}
        </button>
      </noscript>
    </form>
  );
}
