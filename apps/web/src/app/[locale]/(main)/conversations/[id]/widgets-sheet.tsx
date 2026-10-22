"use client";

import { PanelRight } from "lucide-react";
import { useEffect, useRef } from "react";
import { takeDetailsFocus } from "@/app/[locale]/(main)/conversations/[id]/details-focus";
import type { WidgetsSheetPopupProps } from "@/app/[locale]/(main)/conversations/[id]/widgets-sheet-popup";
import { buttonVariants } from "@/components/ui/button";
import { LazyPopup } from "@/components/ui/lazy-popup";
import { cn } from "@/lib/utils";

// The sheet's code (Base UI) is fetched when the button is first reached for; until then the
// button is a plain one, so the conversation's first load does not carry it.
const loadPopup = () =>
  import("@/app/[locale]/(main)/conversations/[id]/widgets-sheet-popup");

// The conversation's widgets below the desktop layout, where the aside column does not exist: a
// header button opens them in a drawer. The widgets are the same server-rendered components the
// aside shows; this copy is mounted only while the drawer is open (the aside's is always in the
// page, hidden by CSS below the desktop layout).
export function WidgetsSheet(popup: WidgetsSheetPopupProps) {
  const trigger = useRef<HTMLButtonElement>(null);
  // Drawn anew after a write made inside the drawer (adding people ends in a redirect): the form
  // that had the focus is gone, so the button that opened the drawer takes it.
  useEffect(() => {
    if (takeDetailsFocus()) trigger.current?.focus();
  }, []);
  return (
    <LazyPopup
      load={loadPopup}
      popup={popup}
      trigger={(lazy) => (
        <button
          ref={trigger}
          type="button"
          data-slot="sheet-trigger"
          aria-haspopup="dialog"
          aria-expanded="false"
          className={cn(
            buttonVariants({ variant: "ghost" }),
            "h-10 px-2 text-xs lg:hidden",
          )}
          {...lazy}
        >
          <PanelRight />
          {popup.label}
        </button>
      )}
    />
  );
}
