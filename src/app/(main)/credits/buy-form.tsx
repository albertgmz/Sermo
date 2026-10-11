"use client";

import { useActionState } from "react";
import { buyItem, type PurchaseState } from "@/app/(main)/credits/actions";
import { PendingButton } from "@/components/forum/pending-button";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const ERRORS = {
  not_found: "No longer available.",
  already_owned: "You already own this.",
  insufficient_credits: "Not enough credits.",
};

export function BuyForm({
  itemId,
  itemName,
  missing,
  children,
}: {
  itemId: number;
  itemName: string;
  missing: number;
  children?: React.ReactNode;
}) {
  const [state, action] = useActionState<PurchaseState, FormData>(
    buyItem.bind(null, itemId),
    null,
  );

  let status = "";
  if (state) {
    status = ERRORS[state.error];
  } else if (missing > 0) {
    status = `${formatNumber(missing)} credits short`;
  }

  return (
    <form action={action}>
      <div className="flex gap-2">
        <PendingButton
          disabled={missing > 0}
          aria-label={`Buy ${itemName}`}
          className="h-10 min-w-0 flex-1"
        >
          Buy
        </PendingButton>
        {children}
      </div>
      <output
        className={cn(
          "mt-1.5 block h-4 truncate text-xs",
          state ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {status}
      </output>
    </form>
  );
}
