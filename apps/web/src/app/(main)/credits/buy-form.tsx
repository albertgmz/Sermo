"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { buyItem, type PurchaseState } from "@/app/(main)/credits/actions";
import { PendingButton } from "@/components/forum/pending-button";
import { cn } from "@/lib/utils";

const ERRORS = {
  not_found: "notFound",
  already_owned: "alreadyOwned",
  insufficient_credits: "insufficientCredits",
} as const;

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
  const t = useTranslations("credits.buyForm");
  const [state, action] = useActionState<PurchaseState, FormData>(
    buyItem.bind(null, itemId),
    null,
  );

  let status = "";
  if (state) {
    status = t(`errors.${ERRORS[state.error]}`);
  } else if (missing > 0) {
    status = t("credits", { count: missing });
  }

  return (
    <form action={action}>
      <div className="flex gap-2">
        <PendingButton
          disabled={missing > 0}
          aria-label={t("aria.submit", { itemName })}
          className="h-10 min-w-0 flex-1"
        >
          {t("submit")}
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
