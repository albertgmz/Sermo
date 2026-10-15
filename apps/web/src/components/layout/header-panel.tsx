"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// A header icon that opens a panel under it, at every width: on a phone the panel is never wider
// than the screen. Following a link inside the
// panel closes it. `onOpenChange` runs each time the panel opens or closes, however it closes.
export function HeaderPanel({
  label,
  title,
  unread = 0,
  icon,
  className,
  shortcut,
  onOpenChange,
  children,
}: {
  label: string;
  title: string;
  unread?: number;
  icon: React.ReactNode;
  className?: string;
  // The name a keyboard shortcut finds this button by (`data-shortcut`).
  shortcut?: string;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const t = useTranslations("layout.headerPanel");
  const [open, setOpen] = useState(false);
  function change(next: boolean) {
    setOpen(next);
    onOpenChange?.(next);
  }
  return (
    <Popover open={open} onOpenChange={change}>
      <PopoverTrigger
        data-shortcut={shortcut}
        aria-label={unread ? t("aria.unread", { label, count: unread }) : label}
        className={cn(
          "outline-none focus-visible:ring-2 focus-visible:ring-ring data-popup-open:text-foreground",
          className,
        )}
      >
        {icon}
        {unread > 0 && (
          <span className="absolute top-2 right-2 size-2 rounded-full bg-primary ring-2 ring-background" />
        )}
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
