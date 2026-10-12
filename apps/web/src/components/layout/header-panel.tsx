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

// A header icon that opens a panel under it. Following a link inside the
// panel closes it.
export function HeaderPanel({
  label,
  title,
  unread = 0,
  icon,
  className,
  children,
}: {
  label: string;
  title: string;
  unread?: number;
  icon: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("layout.headerPanel");
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
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
        className="w-88 gap-0 p-0"
        onClick={(event) => {
          if (event.defaultPrevented) return;
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
