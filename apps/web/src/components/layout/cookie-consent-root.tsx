"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  consentLibrary,
  startConsent,
} from "@/components/layout/consent-library";
import { type ConsentTexts, consentConfig } from "@/lib/consent/config";
import { effectOf } from "@/lib/consent/effects";
import { OPTIONAL_CATEGORIES } from "@/lib/consent/inventory";

// Starts the cookie banner once and keeps it in step with the page (`effectOf` says how). Anything
// marked `data-consent-settings` (the footer button, the cookie policy page) opens the settings.
// Renders nothing: the library draws its own dialogs.
export function CookieConsentRoot({
  texts,
  locale,
  version,
}: {
  texts: Record<string, ConsentTexts>;
  locale: string;
  version: number;
}) {
  const router = useRouter();
  const refresh = useRef(router.refresh);
  refresh.current = router.refresh;
  const first = useRef({ texts, locale, version });
  useEffect(() => {
    const { texts, locale, version } = first.current;
    startConsent({
      ...consentConfig(texts, locale, version, window.location.hostname),
      onFirstConsent: async () => {
        const library = await consentLibrary();
        if (
          library &&
          OPTIONAL_CATEGORIES.some((c) => library.acceptedCategory(c))
        )
          refresh.current();
      },
      onChange: async ({ changedCategories }) => {
        const library = await consentLibrary();
        if (!library) return;
        const accepted = library.getUserPreferences().acceptedCategories;
        const effect = effectOf(changedCategories, accepted);
        if (effect === "reload") window.location.reload();
        else if (effect === "refresh") refresh.current();
      },
    });
    const open = (event: MouseEvent) => {
      if (
        !(event.target as Element | null)?.closest?.("[data-consent-settings]")
      )
        return;
      event.preventDefault();
      consentLibrary()?.then((library) => library?.showPreferences());
    };
    document.addEventListener("click", open);
    return () => document.removeEventListener("click", open);
  }, []);
  useEffect(() => {
    consentLibrary()?.then((library) => library?.setLanguage(locale));
  }, [locale]);
  return null;
}
