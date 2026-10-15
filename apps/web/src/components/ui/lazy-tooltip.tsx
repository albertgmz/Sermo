"use client";

import type { LazyTooltipPopupProps } from "@/components/ui/lazy-tooltip-popup";
import { LazyPopup } from "@/components/ui/lazy-popup";

// The tooltip's code (Base UI and the positioning library) is fetched when the pointer first
// comes over a trigger, or a keyboard focuses it.
const loadPopup = () => import("@/components/ui/lazy-tooltip-popup");

// A picture-like span that names itself on hover: the icon-only marks of the postbit (awards,
// group hearts, the browser and system). It stays a real tooltip, not a `title`, which does not
// work on touch; until the pointer comes it is the plain span.
export function LazyTooltip(props: LazyTooltipPopupProps) {
  const { label, className, style, children } = props;
  return (
    <LazyPopup
      load={loadPopup}
      popup={props}
      opening="hover"
      trigger={(lazy) => (
        <span
          role="img"
          data-slot="tooltip-trigger"
          aria-label={label}
          className={className}
          style={style}
          {...lazy}
        >
          {children}
        </span>
      )}
    />
  );
}
