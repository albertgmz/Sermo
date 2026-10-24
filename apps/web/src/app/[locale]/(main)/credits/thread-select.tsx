"use client";

import { ChevronDownIcon } from "lucide-react";
import type { ThreadSelectProps } from "@/app/[locale]/(main)/credits/thread-select-popup";
import { LazyPopup } from "@/components/ui/lazy-popup";
import { SELECT_TRIGGER } from "@/components/ui/select-trigger-class";
import { cn } from "@/lib/utils";

// The select Base UI draws is not part of the page's first load. Until the member reaches for it
// the page holds a plain button that looks the same (nothing moves when the real one arrives); the
// first pointer over it, touch or focus fetches the code, and the press that asks for the list
// opens it on the real select.
const loadSelect = () =>
  import("@/app/[locale]/(main)/credits/thread-select-popup");

export function ThreadSelect(props: ThreadSelectProps) {
  return (
    <LazyPopup
      load={loadSelect}
      popup={props}
      opening="menu"
      trigger={(lazy) => (
        <button
          type="button"
          data-slot="select-trigger"
          data-size="default"
          data-placeholder=""
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded="false"
          aria-label={props.label}
          className={cn(SELECT_TRIGGER, props.triggerClass)}
          {...lazy}
        >
          <span
            data-slot="select-value"
            className="flex flex-1 text-left"
            data-placeholder=""
          >
            {props.placeholder}
          </span>
          <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" />
        </button>
      )}
    />
  );
}
