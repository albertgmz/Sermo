"use client";

import { Ellipsis } from "lucide-react";
import { useTranslations } from "next-intl";
import { useContext } from "react";
import { MenuPanels } from "@/components/forum/content-actions";
import type { ContentMenuPopupProps } from "@/components/forum/content-menu-popup";
import { LazyPopup } from "@/components/ui/lazy-popup";

const loadPopup = () => import("@/components/forum/content-menu-popup");

// The "•••" button of an item's footer (XenForo's "Más opciones"), which holds what the viewer may
// do to the item besides reporting and sharing it: edit, delete. The menu's code (Base UI) is
// fetched when the button is first reached for. Draws nothing when there is nothing to hold. It
// goes in `ContentActions`' `menu` slot, whose bar says what it may open (`MenuPanels`).
export function ContentMenu({ className }: { className: string }) {
  const t = useTranslations("forum.contentActions");
  const panels = useContext(MenuPanels);
  if (!panels.edit && !panels.remove) return null;
  const popup: ContentMenuPopupProps = {
    className,
    onEdit: panels.edit ? () => panels.open("edit") : undefined,
    onDelete: panels.remove ? () => panels.open("delete") : undefined,
  };
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
          className={className}
          {...lazy}
        >
          <Ellipsis />
        </button>
      )}
    />
  );
}
