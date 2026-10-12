"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { buyItem, type CreditsState } from "@/app/(main)/credits/actions";
import { PendingButton } from "@/components/forum/pending-button";
import { Input } from "@/components/ui/input";

export function BuyForm({
  itemId,
  itemName,
  returnTo,
  quantity,
  left,
}: {
  itemId: number;
  itemName: string;
  returnTo: string;
  // A consumable is bought in a quantity.
  quantity: boolean;
  // Units in stock, when the stock is limited.
  left: number | null;
}) {
  const t = useTranslations("credits.buyForm");
  const [state, action] = useActionState<CreditsState, FormData>(
    buyItem.bind(null, itemId, returnTo),
    {},
  );
  return (
    <form action={action}>
      <div className="flex gap-2">
        {quantity && (
          <Input
            type="number"
            name="quantity"
            defaultValue={1}
            min={1}
            max={left === null ? undefined : Math.max(1, left)}
            inputMode="numeric"
            aria-label={t("aria.quantity", { itemName })}
            className="h-10 w-20 shrink-0"
          />
        )}
        <PendingButton
          aria-label={t("aria.submit", { itemName })}
          className="h-10 min-w-0 flex-1"
        >
          {t("submit")}
        </PendingButton>
      </div>
      <output className="mt-1.5 block text-xs text-destructive empty:hidden">
        {state.error}
      </output>
    </form>
  );
}
