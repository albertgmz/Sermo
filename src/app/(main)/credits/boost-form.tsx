"use client";

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
  no_thread: "Choose one of your threads first.",
  not_found: "This item or thread no longer exists.",
  not_owned: "You have none of this item left.",
  not_author: "You can only use this on your own threads.",
};

export function BoostForm({
  itemId,
  itemName,
  threads,
}: {
  itemId: number;
  itemName: string;
  threads: { value: string; label: string }[];
}) {
  const [state, action] = useActionState<BoostState, FormData>(
    spendBoost.bind(null, itemId),
    null,
  );
  return (
    <form action={action} className="min-w-0">
      <div className="flex gap-2">
        <Select name="thread" items={threads}>
          <SelectTrigger
            aria-label={`Thread to use ${itemName} on`}
            className="w-full min-w-0 flex-1 data-[size=default]:h-10 md:data-[size=default]:h-8"
          >
            <SelectValue placeholder="Choose a thread" />
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
          aria-label={`Use ${itemName} on the chosen thread`}
          className="h-10 px-4 md:h-8 md:px-3"
        >
          Use
        </PendingButton>
      </div>
      <output className="mt-1.5 block text-xs text-destructive empty:hidden">
        {state && ERRORS[state.error]}
      </output>
    </form>
  );
}
