"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { type ConsentTexts, consentConfig } from "@/lib/consent/config";
import { OPTIONAL_CATEGORIES } from "@/lib/consent/inventory";

type Library = typeof import("vanilla-cookieconsent");

// Starts the cookie banner once and keeps it in step with the page: a choice that changes what the
// server draws (the analytics tag, the players) refreshes the page; withdrawing analytics reloads
// it, because a tracker that is already running only stops with its page. Anything marked
// `data-consent-settings` (the footer button, the cookie policy page) opens the settings.
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
  const ready = useRef<Promise<Library> | null>(null);
  const first = useRef({ texts, locale, version });
  useEffect(() => {
    const { texts, locale, version } = first.current;
    ready.current ??= import("vanilla-cookieconsent").then(async (library) => {
      await library.run({
        ...consentConfig(texts, locale, version),
        onFirstConsent: () => {
          if (OPTIONAL_CATEGORIES.some((c) => library.acceptedCategory(c)))
            refresh.current();
        },
        onChange: ({ changedCategories }) => {
          if (
            changedCategories.includes("analytics") &&
            !library.acceptedCategory("analytics")
          ) {
            window.location.reload();
          } else if (
            changedCategories.some((c) =>
              (OPTIONAL_CATEGORIES as readonly string[]).includes(c),
            )
          ) {
            refresh.current();
          }
        },
      });
      return library;
    });
    const open = (event: MouseEvent) => {
      if (
        !(event.target as Element | null)?.closest?.("[data-consent-settings]")
      )
        return;
      event.preventDefault();
      ready.current?.then((library) => library.showPreferences());
    };
    document.addEventListener("click", open);
    return () => document.removeEventListener("click", open);
  }, []);
  useEffect(() => {
    ready.current?.then((library) => library.setLanguage(locale));
  }, [locale]);
  return null;
}
