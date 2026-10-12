"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { type EquipState, equipItem } from "@/app/(main)/credits/actions";
import { PendingButton } from "@/components/forum/pending-button";
import { cn } from "@/lib/utils";

const ERRORS = {
  not_owned: "notOwned",
  invalid: "invalid",
} as const;

export function EquipForm({
  itemId,
  itemName,
  equipped,
  from,
  className,
}: {
  itemId: number;
  itemName: string;
  equipped: boolean;
  from: "shop" | "inventory";
  className?: string;
}) {
  const t = useTranslations("credits.equipForm");
  const [state, action] = useActionState<EquipState, FormData>(
    equipItem.bind(null, itemId, !equipped, from),
    null,
  );
  return (
    <form action={action} className={className}>
      <PendingButton
        variant={equipped ? "outline" : "secondary"}
        aria-label={t(equipped ? "aria.unequip" : "aria.equip", { itemName })}
        className={cn("h-10 w-full", from === "inventory" && "md:h-8")}
      >
        {t(equipped ? "unequip" : "equip")}
      </PendingButton>
      <output
        className={cn(
          "mt-1.5 block truncate text-xs text-destructive",
          from === "shop" ? "h-4" : "empty:hidden",
        )}
      >
        {state && t(`errors.${ERRORS[state.error]}`)}
      </output>
    </form>
  );
}
