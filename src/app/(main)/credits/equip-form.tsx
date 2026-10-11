"use client";

import { useActionState } from "react";
import { type EquipState, equipItem } from "@/app/(main)/credits/actions";
import { PendingButton } from "@/components/forum/pending-button";
import { cn } from "@/lib/utils";

const ERRORS = {
  not_owned: "You do not own this item.",
  invalid: "This item cannot be equipped.",
};

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
  const [state, action] = useActionState<EquipState, FormData>(
    equipItem.bind(null, itemId, !equipped, from),
    null,
  );
  return (
    <form action={action} className={className}>
      <PendingButton
        variant={equipped ? "outline" : "secondary"}
        aria-label={`${equipped ? "Unequip" : "Equip"} ${itemName}`}
        className={cn("h-10 w-full", from === "inventory" && "md:h-8")}
      >
        {equipped ? "Unequip" : "Equip"}
      </PendingButton>
      <output
        className={cn(
          "mt-1.5 block truncate text-xs text-destructive",
          from === "shop" ? "h-4" : "empty:hidden",
        )}
      >
        {state && ERRORS[state.error]}
      </output>
    </form>
  );
}
