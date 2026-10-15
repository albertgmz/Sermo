"use client";

import { useTranslations } from "next-intl";
import { DataSaverMenuItem } from "@/components/layout/data-saver-menu-item";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { LiteState } from "@/lib/lite-preferences";

export function LiteMenuDemo({ state }: { state: LiteState }) {
  const t = useTranslations("lite.liteMenuDemo");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" className="min-h-10" />}
      >
        {t("menuButton")}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-52">
        <DataSaverMenuItem state={state} href="/account/data-saver" />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
