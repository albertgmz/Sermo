"use client";

import { Ellipsis } from "lucide-react";
import type { ProfileMorePopupProps } from "@/app/[locale]/(main)/members/[id]/profile-more-popup";
import { LazyPopup } from "@/components/ui/lazy-popup";

const loadPopup = () =>
  import("@/app/[locale]/(main)/members/[id]/profile-more-popup");

// The button at the end of a profile's icons, which opens a menu of searches for the member's
// posts and threads. The menu's code (Base UI) is fetched when the button is first reached for.
export function ProfileMore(popup: ProfileMorePopupProps) {
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
          aria-label={popup.label}
          className={popup.className}
          {...lazy}
        >
          <Ellipsis className="size-5" />
        </button>
      )}
    />
  );
}
