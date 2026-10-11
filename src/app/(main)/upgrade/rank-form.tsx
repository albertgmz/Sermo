"use client";

import { useActionState } from "react";
import { buyRank, type RankState } from "@/app/(main)/upgrade/actions";
import { PendingButton } from "@/components/forum/pending-button";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const ERRORS = {
  not_found: "This rank is no longer available.",
  not_higher: "You already have this rank or a higher one.",
  insufficient_credits: "You do not have enough credits.",
};

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
  const [state, action] = useActionState<RankState, FormData>(
    buyRank.bind(null, rankId),
    null,
  );

  let status = "";
  if (state) {
    status = ERRORS[state.error];
  } else if (missing > 0) {
    status = `You are ${formatNumber(missing)} credits short.`;
  }

  return (
    <form action={action}>
      <PendingButton
        variant={highlighted ? "default" : "outline"}
        disabled={missing > 0}
        aria-label={`Upgrade to ${rankName} for ${formatNumber(cost)} credits`}
        className="h-10 w-full"
      >
        Upgrade for {formatNumber(cost)}
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
