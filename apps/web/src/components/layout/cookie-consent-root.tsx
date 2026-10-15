"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  consentLibrary,
  startConsent,
} from "@/components/layout/consent-library";
import { saveConsentChoice } from "@/lib/consent/actions";
import { consentCallbacks } from "@/lib/consent/callbacks";
import { type ConsentTexts, consentConfig } from "@/lib/consent/config";
import type { OptionalCategory } from "@/lib/consent/inventory";

// Starts the cookie banner once and keeps it in step with the page (`effectOf` says how). Anything
// marked `data-consent-settings` (the footer button, the cookie policy page) opens the settings.
// Every choice is also sent to be saved on the member's account (nothing happens for a guest).
// `quiet`: the banner is not shown to this visitor. Renders nothing: the library draws its own
// dialogs.
export function CookieConsentRoot({
  texts,
  locale,
  version,
  quiet,
  omit,
}: {
  texts: Record<string, ConsentTexts>;
  locale: string;
  version: number;
  quiet: boolean;
  omit: readonly OptionalCategory[];
}) {
  const router = useRouter();
  const refresh = useRef(router.refresh);
  refresh.current = router.refresh;
  const first = useRef({ texts, locale, version, quiet, omit });
  useEffect(() => {
    const { texts, locale, version, quiet, omit } = first.current;
    startConsent({
      ...consentConfig(texts, locale, version, window.location.hostname, {
        quiet,
        omit,
      }),
      ...consentCallbacks({
        quiet,
        omit,
        library: consentLibrary,
        save: () => void saveConsentChoice(),
        reload: () => window.location.reload(),
        refresh: () => refresh.current(),
      }),
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
