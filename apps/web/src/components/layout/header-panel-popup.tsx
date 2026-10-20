"use client";

import { useState } from "react";
import type { OpenedProps } from "@/components/ui/lazy-popup";
import { usePopupFocus } from "@/components/ui/lazy-popup-focus";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";

export type HeaderPanelPopupProps = {
  label: string;
  title: string;
  // What the button holds: the icon and its unread count.
  trigger: React.ReactNode;
  className: string;
  shortcut?: string;
  children: React.ReactNode;
};

// The button and the panel under it, which Base UI draws. It is loaded when the plain button of
// `HeaderPanel` is pressed and mounts open. Following a link inside the panel closes it.
export default function HeaderPanelPopup({
  label,
  title,
  trigger,
  className,
  shortcut,
  children,
  openedBy,
}: HeaderPanelPopupProps & OpenedProps) {
  const focus = usePopupFocus(openedBy);
  const [open, setOpen] = useState(true);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        data-shortcut={shortcut}
        aria-label={label}
        className={className}
      >
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        ref={focus.ref}
        initialFocus={focus.initialFocus}
        align="end"
        sideOffset={8}
        className="w-88 max-w-[calc(100vw-1rem)] gap-0 p-0"
        // Not judged by `defaultPrevented`: Next's `Link` cancels the default of every click it
        // follows itself, so the panel stayed over the page it had just opened.
        onClick={(event) => {
          if ((event.target as Element).closest("a")) setOpen(false);
        }}
      >
        <PopoverTitle className="border-b px-4 py-3 text-sm font-semibold">
          {title}
        </PopoverTitle>
        {children}
      </PopoverContent>
    </Popover>
  );
}
