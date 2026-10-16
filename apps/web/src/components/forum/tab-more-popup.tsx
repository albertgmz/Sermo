"use client";

import Link from "next/link";
import type { TabLink } from "@/components/forum/tab-links";
import { TabMoreFace } from "@/components/forum/tab-more";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { OpenedProps } from "@/components/ui/lazy-popup";
import { useMenuOpening } from "@/components/ui/lazy-popup-focus";
import { cn } from "@/lib/utils";

export type TabMorePopupProps = {
  tabs: Pick<TabLink, "value" | "label" | "href" | "icon">[];
  label: string;
  className: string;
  narrow: boolean;
};

// The button and the menu of the tabs that do not fit, which Base UI draws. It is loaded when the
// plain button of `TabMore` is pressed and mounts open.
export default function TabMorePopup({
  tabs,
  label,
  className,
  narrow,
  openedBy,
  openKey,
}: TabMorePopupProps & OpenedProps) {
  const { defaultOpen, trigger } = useMenuOpening(openedBy, openKey);
  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger ref={trigger} className={cn("group", className)}>
        <TabMoreFace label={label} narrow={narrow} />
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
