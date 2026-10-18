import { Languages } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { LOCALES } from "@/i18n/locales";
import { languageName } from "@/lib/language-name";
import { cn } from "@/lib/utils";

// The interface languages, each named in its own language and marked with it (a visitor who
// cannot read this page still finds theirs, and a screen reader says it in its own voice). A plain
// form, so it works before any script has run: the `/language` route keeps the choice and loads
// this same address again. Drawn like the theme choices beside it; the current one has a border as
// well as a fill.
export async function LanguageSwitcher() {
  const [t, current] = await Promise.all([
    getTranslations("layout.languageSwitcher"),
    getLocale(),
  ]);
  return (
    <form
      method="post"
      action="/language"
      className="inline-flex items-center gap-1.5"
    >
      <Languages aria-hidden="true" className="size-4 text-muted-foreground" />
      <fieldset
        aria-label={t("label")}
        className="inline-flex rounded-lg border p-0.5"
      >
        {LOCALES.map((code) => {
          const chosen = code === current;
          return (
            <button
              key={code}
              type="submit"
              name="language"
              value={code}
              lang={code}
              aria-current={chosen ? "true" : undefined}
              className={cn(
                "inline-flex min-h-10 items-center justify-center rounded-md border border-transparent px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground md:min-h-8",
                chosen && "border-ring bg-muted text-foreground",
              )}
            >
              {languageName(code)}
            </button>
          );
        })}
      </fieldset>
    </form>
  );
}
