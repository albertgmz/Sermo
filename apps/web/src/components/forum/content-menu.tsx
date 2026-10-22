"use client";

import { Ellipsis } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ContentMenuPopupProps } from "@/components/forum/content-menu-popup";
import { LazyPopup } from "@/components/ui/lazy-popup";

const loadPopup = () => import("@/components/forum/content-menu-popup");

// The "•••" button of an item's footer (XenForo's "Más opciones"), which holds what the viewer may
// do to the item besides reporting and sharing it: edit, delete. The menu's code (Base UI) is
// fetched when the button is first reached for. Draws nothing when there is nothing to hold.
export function ContentMenu(popup: ContentMenuPopupProps) {
  const t = useTranslations("forum.contentActions");
  if (!popup.onEdit && !popup.onDelete) return null;
  return (
    <LazyPopup
      load={loadPopup}
      popup={popup}
      opening="menu"
      trigger={(lazy) => (
        <button
          type="button"
          data-slot="dropdown-menu-trigger"
          aria-haspopup="menu"
          aria-expanded="false"
          aria-label={t("moreOptions")}
          className={popup.className}
          {...lazy}
        >
          <Ellipsis />
        </button>
      )}
    />
  );
}
