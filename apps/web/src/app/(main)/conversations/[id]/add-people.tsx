"use client";

import { UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { addParticipantsAction } from "@/app/(main)/conversations/actions";
import { RecipientPicker } from "@/app/(main)/conversations/new/recipient-picker";
import { ActionForm } from "@/components/forum/action-form";
import { Button } from "@/components/ui/button";

// The "Add people" row of the participants card: a button that opens the recipient picker in
// place. Everyone already taking part is left out of the picker; a member who left is not, as
// the backend lets them back in.
export function AddPeople({
  conversationId,
  exclude,
}: {
  conversationId: number;
  exclude: number[];
}) {
  const t = useTranslations("conversations.conversation.addPeople");
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <div className="px-4 py-2">
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full px-3"
          onClick={() => setOpen(true)}
        >
          <UserPlus />
          {t("open")}
        </Button>
      </div>
    );
  }
  return (
    <ActionForm
      action={addParticipantsAction.bind(null, conversationId)}
      submit={t("submit")}
      aside={
        <Button
          type="button"
          variant="ghost"
          className="h-10 px-3"
          onClick={() => setOpen(false)}
        >
          {t("cancel")}
        </Button>
      }
      className="p-4"
    >
      <RecipientPicker exclude={exclude} />
    </ActionForm>
  );
}
