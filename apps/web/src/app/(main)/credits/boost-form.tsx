"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { type BoostState, spendBoost } from "@/app/(main)/credits/actions";
import { PendingButton } from "@/components/forum/pending-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ERRORS = {
  no_thread: "noThread",
  not_found: "notFound",
  not_owned: "notOwned",
  not_author: "notAuthor",
} as const;

export function BoostForm({
  itemId,
  itemName,
  threads,
}: {
  itemId: number;
  itemName: string;
  threads: { value: string; label: React.ReactNode }[];
}) {
  const t = useTranslations("credits.boostForm");
  const [state, action] = useActionState<BoostState, FormData>(
    spendBoost.bind(null, itemId),
    null,
  );
  return (
    <form action={action} className="min-w-0">
      <div className="flex gap-2">
        <Select name="thread" items={threads}>
          <SelectTrigger
            aria-label={t("aria.thread", { itemName })}
            className="w-full min-w-0 flex-1 data-[size=default]:h-10 md:data-[size=default]:h-8"
          >
            <SelectValue placeholder={t("placeholder")} />
          </SelectTrigger>
          <SelectContent>
            {threads.map((thread) => (
              <SelectItem
                key={thread.value}
                value={thread.value}
                className="min-h-10 md:min-h-8"
              >
                {thread.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <PendingButton
          aria-label={t("aria.submit", { itemName })}
          className="h-10 px-4 md:h-8 md:px-3"
        >
          {t("submit")}
        </PendingButton>
      </div>
      <output className="mt-1.5 block text-xs text-destructive empty:hidden">
        {state && t(`errors.${ERRORS[state.error]}`)}
      </output>
    </form>
  );
}
