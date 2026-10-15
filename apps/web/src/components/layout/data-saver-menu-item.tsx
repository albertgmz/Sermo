"use client";

import { Leaf } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { LiteStatus } from "@/app/[locale]/(main)/data-saver/status";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import type { LiteState } from "@/lib/lite-preferences";

// The one menu entry for the Data saver: its state, and a link to the page where it is changed.
// A member's page is under /account, a guest's is not.
export function DataSaverMenuItem({
  state,
  href,
}: {
  state: LiteState;
  href: "/account/data-saver" | "/data-saver";
}) {
  const t = useTranslations("lite.menuItem");
  return (
    <DropdownMenuItem
      className="min-h-10 md:min-h-8"
      render={<Link href={href} />}
    >
      <Leaf />
      <span>{t("label")}</span>
      <span className="ml-auto text-xs text-muted-foreground">
        <LiteStatus state={state} />
      </span>
    </DropdownMenuItem>
  );
}
