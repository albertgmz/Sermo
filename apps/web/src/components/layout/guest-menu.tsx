"use client";

import { Settings } from "lucide-react";
import { useTranslations } from "next-intl";
import { headerIconClass } from "@/components/layout/header-icon-class";
import { LazyPopup } from "@/components/ui/lazy-popup";
import type { LiteState } from "@/lib/lite-preferences";

const loadPopup = () => import("@/components/layout/guest-menu-popup");

// What a visitor who is not signed in gets in place of the account menu. The menu itself is
// fetched when the button is first reached for.
export function GuestMenu({ lite }: { lite: LiteState }) {
  const t = useTranslations("layout.guestMenu");
  const label = t("aria.menu");
  return (
    <LazyPopup
      load={loadPopup}
      popup={{ label, lite }}
      opening="menu"
      trigger={(lazy) => (
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded="false"
          aria-label={label}
          className={headerIconClass}
          {...lazy}
        >
          <Settings />
        </button>
      )}
    />
  );
}
