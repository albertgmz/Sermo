"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import {
  type CreditsState,
  wearItem,
} from "@/app/[locale]/(main)/credits/actions";
import { useAnnounce } from "@/components/forum/page-notice";
import { PendingButton } from "@/components/forum/pending-button";

export function WearForm({
  look,
  catalogId,
  worn,
  itemName,
  returnTo,
}: {
  look: "frameId" | "nameColorId" | "nameIconItemId";
  catalogId: number;
  worn: boolean;
  itemName: string;
  returnTo: string;
}) {
  const t = useTranslations("credits.wearForm");
  const [state, action] = useActionState<CreditsState>(
    wearItem.bind(null, look, worn ? null : catalogId, returnTo),
    {},
  );
  useAnnounce(state.notice, state);
  return (
    <form action={action} className="basis-full sm:w-32 sm:basis-auto">
      <PendingButton
        variant={worn ? "outline" : "secondary"}
        aria-label={t(worn ? "aria.takeOff" : "aria.wear", { itemName })}
        className="h-10 w-full md:h-8"
      >
        {t(worn ? "takeOff" : "wear")}
      </PendingButton>
      <output className="mt-1.5 block text-xs text-destructive empty:hidden">
        {state.error}
      </output>
    </form>
  );
}
