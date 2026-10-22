"use client";

import { Languages } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import { ChoiceSelect } from "@/components/layout/choice-select";
import { localeCookieValue } from "@/i18n/locale-cookie";
import { isLocale, LOCALES, SYSTEM_LANGUAGE } from "@/i18n/locales";
import { languageName } from "@/lib/language-name";

const noSubscription = () => () => {};

// The language the cookie holds, or System when it holds none. The cookie is the only record of
// the choice in the browser (a page drawn for a member follows their account into it).
function chosenLanguage() {
  const cookie = localeCookieValue(document.cookie);
  return isLocale(cookie) ? cookie : SYSTEM_LANGUAGE;
}

// System first, then each language named in its own language (a visitor who cannot read this page
// still finds theirs). Choosing posts the enclosing form to the `/language` route.
export function LanguageSelect() {
  const t = useTranslations("layout.languageSwitcher");
  const value = useSyncExternalStore(
    noSubscription,
    chosenLanguage,
    () => SYSTEM_LANGUAGE,
  );
  return (
    <ChoiceSelect
      label={t("label")}
      icon={Languages}
      name="language"
      value={value}
      submitOnChange
      options={[
        { value: SYSTEM_LANGUAGE, label: t("system") },
        ...LOCALES.map((code) => ({
          value: code,
          label: languageName(code),
          lang: code,
        })),
      ]}
    />
  );
}
