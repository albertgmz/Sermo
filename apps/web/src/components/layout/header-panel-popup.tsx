"use client";

import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";

export type HeaderPanelPopupProps = {
  label: string;
  title: string;
  // What the button holds: the icon and the unread dot.
  trigger: React.ReactNode;
  className: string;
  shortcut?: string;
  onOpenChange?: (open: boolean) => void;
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
  onOpenChange,
  children,
}: HeaderPanelPopupProps) {
  const [open, setOpen] = useState(true);
  function change(next: boolean) {
    setOpen(next);
    onOpenChange?.(next);
  }
  return (
    <Popover open={open} onOpenChange={change}>
      <PopoverTrigger
        data-shortcut={shortcut}
        aria-label={label}
        className={className}
      >
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-88 max-w-[calc(100vw-1rem)] gap-0 p-0"
        onClick={(event) => {
          if (event.defaultPrevented) return;
          if ((event.target as Element).closest("a")) change(false);
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
