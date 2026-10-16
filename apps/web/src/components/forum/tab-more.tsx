"use client";

import { ChevronDown } from "lucide-react";
import type { TabLink } from "@/components/forum/tab-links";
import type { TabMorePopupProps } from "@/components/forum/tab-more-popup";
import { LazyPopup } from "@/components/ui/lazy-popup";
import { cn } from "@/lib/utils";

const loadPopup = () => import("@/components/forum/tab-more-popup");

// The tabs that do not fit the bar, in a menu at its end. `className` is what a tab link looks
// like in the bar, so the button sits in it like one more tab. The menu's code (Base UI) is
// fetched when the button is first reached for.
export function TabMore({
  tabs,
  label,
  className,
}: {
  tabs: Pick<TabLink, "value" | "label" | "href" | "icon">[];
  label: string;
  className: string;
}) {
  const popup: TabMorePopupProps = { tabs, label, className };
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
          className={cn("group", className)}
          {...lazy}
        >
          {label}
          <ChevronDown className="size-3.5" />
        </button>
      )}
    />
  );
}
