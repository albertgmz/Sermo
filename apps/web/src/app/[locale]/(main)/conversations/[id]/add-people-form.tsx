"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  expectDetailsFocus,
  forgetDetailsFocus,
  isRedirect,
} from "@/app/[locale]/(main)/conversations/[id]/details-focus";
import { addParticipantsAction } from "@/app/[locale]/(main)/conversations/actions";
import { RecipientPicker } from "@/app/[locale]/(main)/conversations/new/recipient-picker";
import { ActionForm } from "@/components/forum/action-form";
import { Button } from "@/components/ui/button";

// The form the "Add people" button opens: the recipient picker and the submit button. It is code
// for a press, so the button loads it only when it is pressed.
export function AddPeopleForm({
  conversationId,
  exclude,
  onCancel,
}: {
  conversationId: number;
  exclude: number[];
  onCancel: () => void;
}) {
  const t = useTranslations("conversations.conversation.addPeople");
  const [picked, setPicked] = useState(0);
  return (
    <ActionForm
      action={async (previous, formData) => {
        // A success is a redirect that draws the drawer anew: its button takes the focus back.
        expectDetailsFocus();
        try {
          const state = await addParticipantsAction(
            conversationId,
            previous,
            formData,
          );
          if (state?.error) forgetDetailsFocus();
          return state;
        } catch (error) {
          // A success rejects with a redirect (Next sends the page elsewhere); any other throw is
          // no success.
          if (!isRedirect(error)) forgetDetailsFocus();
          throw error;
        }
      }}
      submit={t("submit")}
      aside={
        <Button
          type="button"
          variant="ghost"
          className="h-10 px-3"
          onClick={onCancel}
        >
          {t("cancel")}
        </Button>
      }
      submitDisabled={picked === 0}
      className="p-4"
    >
      <RecipientPicker exclude={exclude} onCount={setPicked} />
    </ActionForm>
  );
}
