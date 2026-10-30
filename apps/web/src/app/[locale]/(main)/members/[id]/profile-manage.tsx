"use client";

import { Settings } from "lucide-react";
import type { ProfileManagePopupProps } from "@/app/[locale]/(main)/members/[id]/profile-manage-popup";
import { LazyPopup } from "@/components/ui/lazy-popup";

const loadPopup = () =>
  import("@/app/[locale]/(main)/members/[id]/profile-manage-popup");

// The "Manage" button of a profile, which opens a menu of the member's admin tabs. The menu's code
// (Base UI) is fetched when the button is first reached for.
export function ProfileManage(popup: ProfileManagePopupProps) {
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
          className={popup.className}
          {...lazy}
        >
          <Settings />
          {popup.label}
        </button>
      )}
    />
  );
}
