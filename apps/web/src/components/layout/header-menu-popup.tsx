"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { hasHref, linkProps, type NavItem } from "@/components/layout/nav";
import { NavLabel } from "@/components/layout/nav-label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type HeaderMenuPopupProps = {
  entry: NavItem;
  current: boolean;
  className: string;
};

// A heading of the header navigation and the menu of its links, which Base UI draws. It is loaded
// when the plain button of `HeaderEntry` is pressed and mounts open. An entry with a page keeps it
// as the first line of the menu.
export default function HeaderMenuPopup({
  entry,
  current,
  className,
}: HeaderMenuPopupProps) {
  return (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger
        aria-current={current ? "page" : undefined}
        className={className}
      >
        <NavLabel item={entry} />
        <ChevronDown className="size-3.5 transition-transform group-data-popup-open:rotate-180" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {[entry, ...entry.children].filter(hasHref).map((link) => (
          <DropdownMenuItem
            key={link.id}
            className="min-h-10 md:min-h-8"
            render={<Link {...linkProps(link)} />}
          >
            <NavLabel item={link} className="" />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
