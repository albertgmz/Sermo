"use client";

import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { type InstallOffer, installOffer } from "@/lib/app-prompts";
import {
  askForInstallCard,
  promptInstall,
  useInstallState,
} from "@/lib/install-prompt";
import { currentPlatform } from "@/lib/push-client";

// "Install app" in the account menu, for whoever put the install card off: the browser's dialog
// where there is one, the iOS steps otherwise. Not shown inside the installed app, nor where the
// forum cannot be installed, nor for iOS on a page without the cards. A press closes the menu (`data-menu-close`).
export function InstallAppItem({ className }: { className: string }) {
  const t = useTranslations("layout.userMenu");
  const { native, host } = useInstallState();
  const [offer, setOffer] = useState<InstallOffer>(null);
  useEffect(() => {
    setOffer(installOffer(currentPlatform(), native));
  }, [native]);
  // The iOS steps are a card of the forum's pages; the panel has none to show.
  if (!offer || (offer === "ios" && !host)) return null;
  return (
    <li>
      <button
        type="button"
        data-menu-close=""
        className={className}
        onClick={() => {
          if (offer === "native") void promptInstall();
          else askForInstallCard();
        }}
      >
        <Download aria-hidden="true" className="size-4" />
        {t("installApp")}
      </button>
    </li>
  );
}
