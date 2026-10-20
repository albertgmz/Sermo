"use client";

import { useTranslations } from "next-intl";

// What a trigger says when its popup could not be loaded and the page was already reloaded once
// (or cannot be). An alert, announced at once, in the one place a visitor looks after pressing a
// button: above the phone bar on a phone, the corner of the window from `md`.
export function LazyPopupNotice() {
  const t = useTranslations("layout.lazyPopup");
  return (
    <p
      role="alert"
      data-lazy-popup-notice=""
      className="fixed inset-x-4 bottom-20 z-[60] rounded-lg border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-md md:inset-x-auto md:right-4 md:bottom-4 md:max-w-sm"
    >
      {t("failed")}
    </p>
  );
}
