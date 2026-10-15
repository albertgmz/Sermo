"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import type { TabLink } from "@/components/forum/tab-links";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// The tabs that do not fit the bar, in a menu at its end. `className` is what a tab link looks
// like in the bar, so the button sits in it like one more tab.
export function TabMore({
  tabs,
  label,
  className,
}: {
  tabs: Pick<TabLink, "value" | "label" | "href" | "icon">[];
  label: string;
  className: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn("group", className)}>
        {label}
        <ChevronDown className="size-3.5 transition-transform group-data-popup-open:rotate-180" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {tabs.map((tab) => (
          <DropdownMenuItem
            key={tab.value}
            className="min-h-10 md:min-h-8"
            render={<Link href={tab.href} scroll={false} />}
          >
            {tab.icon}
            {tab.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
