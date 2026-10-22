"use client";

import { Languages } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import { ChoiceSelect } from "@/components/layout/choice-select";
import { localeCookieValue, SYSTEM_LANGUAGE } from "@/i18n/locale-cookie";

const noSubscription = () => () => {};

// The languages come from the server, which keeps the backend contracts out of the browser bundle.
// System first, then each language named in its own language (a visitor who cannot read this page
// still finds theirs). Choosing posts the enclosing form to the `/language` route.
export function LanguageSelect({
  languages,
}: {
  languages: { code: string; name: string }[];
}) {
  const t = useTranslations("layout.languageSwitcher");
  const value = useSyncExternalStore(
    noSubscription,
    () => {
      const cookie = localeCookieValue(document.cookie);
      return languages.some(({ code }) => code === cookie)
        ? (cookie as string)
        : SYSTEM_LANGUAGE;
    },
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
        ...languages.map(({ code, name }) => ({
          value: code,
          label: name,
          lang: code,
        })),
      ]}
    />
  );
}
