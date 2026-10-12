"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { buyRank, type RankState } from "@/app/(main)/upgrade/actions";
import { PendingButton } from "@/components/forum/pending-button";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const ERRORS = {
  not_found: "notFound",
  not_higher: "notHigher",
  insufficient_credits: "insufficientCredits",
} as const;

export function RankForm({
  rankId,
  rankName,
  cost,
  missing,
  highlighted,
}: {
  rankId: number;
  rankName: string;
  cost: number;
  missing: number;
  highlighted: boolean;
}) {
  const t = useTranslations("upgrade.rankForm");
  const [state, action] = useActionState<RankState, FormData>(
    buyRank.bind(null, rankId),
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
      <PendingButton
        variant={highlighted ? "default" : "outline"}
        disabled={missing > 0}
        aria-label={t("aria.submit", { rank: rankName, count: cost })}
        className="h-10 w-full"
      >
        {t("submit", { cost: formatNumber(cost) })}
      </PendingButton>
      <output
        className={cn(
          "mt-2 block h-4 truncate text-xs",
          state ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {status}
      </output>
    </form>
  );
}
