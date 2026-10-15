"use client";

import { Settings } from "lucide-react";
import { useTranslations } from "next-intl";
import { DataSaverMenuItem } from "@/components/layout/data-saver-menu-item";
import { headerIconClass } from "@/components/layout/header-icon-class";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { LiteState } from "@/lib/lite-preferences";

// What a visitor who is not signed in gets in place of the account menu.
export function GuestMenu({ lite }: { lite: LiteState }) {
  const t = useTranslations("layout.guestMenu");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("aria.menu")}
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
