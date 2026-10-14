"use client";

import { useTranslations } from "next-intl";
import { renameAction } from "@/app/[locale]/(main)/conversations/actions";
import { ActionForm } from "@/components/forum/action-form";
import { Input } from "@/components/ui/input";

// The title of the conversation, changed in place.
export function RenameForm({
  conversationId,
  title,
}: {
  conversationId: number;
  title: string;
}) {
  const t = useTranslations("conversations.conversation.rename");
  return (
    <ActionForm
      action={renameAction.bind(null, conversationId)}
      submit={t("submit")}
      className="p-4"
    >
      <Input
        name="title"
        defaultValue={title}
        required
        autoComplete="off"
        aria-label={t("label")}
        className="h-10 md:h-8"
      />
    </ActionForm>
  );
}
