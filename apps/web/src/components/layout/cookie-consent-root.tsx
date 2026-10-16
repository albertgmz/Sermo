"use client";

import { Cookie } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  consentLibrary,
  startConsent,
} from "@/components/layout/consent-library";
import { saveConsentChoice } from "@/lib/consent/actions";
import { consentCallbacks, mustReloadForQuiet } from "@/lib/consent/callbacks";
import { type ConsentTexts, consentConfig } from "@/lib/consent/config";
import type { OptionalCategory } from "@/lib/consent/inventory";
import { reserveBannerSpace } from "@/lib/consent/space";

// Starts the cookie banner once and keeps it in step with the page (`effectOf` says how). Anything
// marked `data-consent-settings` (the footer button, the cookie policy page) opens the settings.
// Every choice is also sent to be saved on the member's account (nothing happens for a guest).
// `quiet`: the banner is not shown to this visitor. The library draws its own dialogs from markup,
// so the only thing rendered is the cookie icon of "Accept all", hidden, for its markup to be
// copied into the button.
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
  const icon = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const { texts, locale, version, quiet, omit } = first.current;
    // The room the page keeps for the banner, given back when the banner goes or the page does.
    let release: (() => void) | undefined;
    const giveBack = () => {
      release?.();
      release = undefined;
    };
    startConsent({
      ...consentConfig(texts, locale, version, window.location.hostname, {
        quiet,
        omit,
        acceptIcon: icon.current?.innerHTML,
      }),
      onModalShow: ({ modalName }) => {
        const banner = document.querySelector("#cc-main .cm");
        if (modalName !== "consentModal" || !banner) return;
        giveBack();
        release = reserveBannerSpace(document.documentElement, banner);
      },
      onModalHide: ({ modalName }) => {
        if (modalName === "consentModal") giveBack();
      },
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
    return () => {
      document.removeEventListener("click", open);
      giveBack();
    };
  }, []);
  useEffect(() => {
    consentLibrary()?.then((library) => library?.setLanguage(locale));
  }, [locale]);
  // The page the banner was started for can become one the visitor must be asked on (a guest
  // outside Europe signs in without a full load). The library cannot be started again, so the page
  // is loaded again, which starts it as the server now says.
  const wasQuiet = useRef(quiet);
  useEffect(() => {
    if (mustReloadForQuiet(wasQuiet.current, quiet)) window.location.reload();
    wasQuiet.current = quiet;
  }, [quiet]);
  return (
    <span ref={icon} hidden>
      <Cookie aria-hidden="true" />
    </span>
  );
}
