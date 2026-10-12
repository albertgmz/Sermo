"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { buyRank, type RankState } from "@/app/(main)/upgrade/actions";
import { PendingButton } from "@/components/forum/pending-button";

export function RankForm({
  itemId,
  rankName,
  cost,
  upgrade,
}: {
  itemId: number;
  rankName: string;
  // What the member pays, already formatted.
  cost: string;
  // The member holds a lower rank: this is a step up from it.
  upgrade: boolean;
}) {
  const t = useTranslations("upgrade.rankForm");
  const [state, action] = useActionState<RankState>(
    buyRank.bind(null, itemId),
    {},
  );
  return (
    <form action={action}>
      <PendingButton
        aria-label={t("aria.submit", { rank: rankName })}
        className="h-10 w-full"
      >
        {t(upgrade ? "upgrade" : "buy", { cost })}
      </PendingButton>
      <output className="mt-2 block text-xs text-destructive empty:hidden">
        {state.error}
      </output>
    </form>
  );
}
