"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import {
  type CreditsState,
  spendItem,
} from "@/app/[locale]/(main)/credits/actions";
import { useAnnounce } from "@/components/forum/page-notice";
import { PendingButton } from "@/components/forum/pending-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Uses one unit of an item. An item that acts on a thread asks which of the member's own threads.
export function UseForm({
  inventoryId,
  itemName,
  returnTo,
  threads,
}: {
  inventoryId: number;
  itemName: string;
  returnTo: string;
  threads: { value: string; label: string }[] | null;
}) {
  const t = useTranslations("credits.useForm");
  const [state, action] = useActionState<CreditsState, FormData>(
    spendItem.bind(null, inventoryId, returnTo),
    {},
  );
  useAnnounce(state.notice, state);
  return (
    <form action={action} className="min-w-0 basis-full">
      <div className="flex gap-2">
        {threads && (
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
        )}
        <PendingButton
          aria-label={t("aria.submit", { itemName })}
          className="h-10 px-4 md:h-8 md:px-3"
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
