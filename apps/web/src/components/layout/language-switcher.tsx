import { Languages } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { LOCALES } from "@/i18n/locales";
import { languageName } from "@/lib/language-name";

// The switcher's element id: the route sends the browser back to it, so the page loads again
// scrolled to the control the reader used (and the next Tab starts there), not at its top.
export const LANGUAGE_SWITCHER_ID = "language";

const OPTION =
  "inline-flex min-h-10 items-center justify-center rounded-md border px-2.5 text-sm font-medium md:min-h-8";

// The interface languages, each named in its own language and marked with it (a visitor who
// cannot read this page still finds theirs, and a screen reader says it in its own voice). A plain
// form, so it works before any script has run: the `/language` route keeps the choice and loads
// this same address again. Drawn like the theme choices beside it; the current language has a
// border as well as a fill, and is no button: choosing it again would change nothing.
export function LanguageSwitcher() {
  const t = useTranslations("layout.languageSwitcher");
  const current = useLocale();
  return (
    <form
      id={LANGUAGE_SWITCHER_ID}
      method="post"
      action="/language"
      className="inline-flex items-center gap-1.5"
    >
      <Languages aria-hidden="true" className="size-4 text-muted-foreground" />
      <fieldset
        aria-label={t("label")}
        className="inline-flex rounded-lg border p-0.5"
      >
        {LOCALES.map((code) =>
          code === current ? (
            <span
              key={code}
              lang={code}
              aria-current="true"
              className={`${OPTION} border-ring bg-muted text-foreground`}
            >
              {languageName(code)}
            </span>
          ) : (
            <button
              key={code}
              type="submit"
              name="language"
              value={code}
              lang={code}
              className={`${OPTION} border-transparent text-muted-foreground transition-colors hover:text-foreground`}
            >
              {languageName(code)}
            </button>
          ),
        )}
      </fieldset>
    </form>
  );
}
