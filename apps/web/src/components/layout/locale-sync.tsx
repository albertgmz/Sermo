"use client";

import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { useEffect } from "react";
import { setLocaleCookie } from "@/app/[locale]/(main)/actions";
import { localeSync } from "@/components/layout/locale-sync-step";
import { localeCookieValue } from "@/i18n/locale-cookie";

// A member signing in on a browser that shows the site in another language than the one they saved
// (their choice lives in the backend, the page follows a cookie). The cookie is written by a
// Server Action, which also drops every page the router kept in the old language; the refresh then
// reads the current page again in the new one. The server renders this only when the languages
// differ.
export function LocaleSync({ language }: { language: string | null }) {
  const active = useLocale();
  const router = useRouter();
  useEffect(() => {
    const step = localeSync({
      language,
      active,
      cookie: localeCookieValue(document.cookie),
    });
    if (!step) return;
    let cancelled = false;
    setLocaleCookie(step.set).then(
      () => {
        if (!cancelled) router.refresh();
      },
      // The cookie could not be written: the page stays in the language it has.
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [language, active, router]);
  return null;
}
