"use client";

import { Settings } from "lucide-react";
import { DataSaverMenuItem } from "@/components/layout/data-saver-menu-item";
import { headerIconClass } from "@/components/layout/header-icon-class";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { OpenedProps } from "@/components/ui/lazy-popup";
import { useMenuOpening } from "@/components/ui/lazy-popup-focus";
import type { LiteState } from "@/lib/lite-preferences";

export type GuestMenuPopupProps = { label: string; lite: LiteState };

// The guest's options button and its menu, which Base UI draws. It is loaded when the plain button
// of `GuestMenu` is pressed and mounts open.
export default function GuestMenuPopup({
  label,
  lite,
  openedBy,
  openKey,
}: GuestMenuPopupProps & OpenedProps) {
  const { defaultOpen, trigger } = useMenuOpening(openedBy, openKey);
  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger
        ref={trigger}
        aria-label={label}
        className={headerIconClass}
      >
        <Settings />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DataSaverMenuItem state={lite} href="/data-saver" />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
