"use client";

import { ChevronDown, Ellipsis } from "lucide-react";
import type { TabLink } from "@/components/forum/tab-links";
import type { TabMorePopupProps } from "@/components/forum/tab-more-popup";
import { LazyPopup } from "@/components/ui/lazy-popup";
import { cn } from "@/lib/utils";

const loadPopup = () => import("@/components/forum/tab-more-popup");

// What the menu button shows, before and after its menu is loaded. Narrow, below `sm` it is an icon
// named by its label.
export function TabMoreFace({
  label,
  narrow,
}: {
  label: string;
  narrow: boolean;
}) {
  return (
    <>
      {narrow && <Ellipsis className="sm:hidden" />}
      {narrow ? <span className="max-sm:sr-only">{label}</span> : label}
      <ChevronDown
        className={cn(
          "size-3.5 transition-transform group-data-popup-open:rotate-180",
          narrow && "max-sm:hidden",
        )}
      />
    </>
  );
}

// The tabs that do not fit the bar, in a menu at its end. `className` is what a tab link looks
// like in the bar, so the button sits in it like one more tab. The menu's code (Base UI) is
// fetched when the button is first reached for.
export function TabMore({
  tabs,
  label,
  className,
  narrow = false,
}: {
  tabs: Pick<TabLink, "value" | "label" | "href" | "icon">[];
  label: string;
  className: string;
  narrow?: boolean;
}) {
  const popup: TabMorePopupProps = { tabs, label, className, narrow };
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
          <TabMoreFace label={label} narrow={narrow} />
        </button>
      )}
    />
  );
}
