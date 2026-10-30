"use client";

import { Settings } from "lucide-react";
import Link from "next/link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { OpenedProps } from "@/components/ui/lazy-popup";
import { useMenuOpening } from "@/components/ui/lazy-popup-focus";

export type ProfileManagePopupProps = {
  label: string;
  className: string;
  items: { key: string; label: string; href: string }[];
};

// The button and its menu, which Base UI draws. It is loaded when the plain button of
// `ProfileManage` is pressed and mounts open.
export default function ProfileManagePopup({
  label,
  className,
  items,
  openedBy,
  openKey,
}: ProfileManagePopupProps & OpenedProps) {
  const { defaultOpen, trigger } = useMenuOpening(openedBy, openKey);
  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger ref={trigger} className={className}>
        <Settings />
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {items.map((item) => (
          <DropdownMenuItem
            key={item.key}
            className="min-h-10 md:min-h-8"
            render={<Link href={item.href} />}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
