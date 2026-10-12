"use client";

import { useTranslations } from "next-intl";
import { LiteModeToggle } from "@/components/layout/lite-mode-toggle";
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
        <LiteModeToggle state={state} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
