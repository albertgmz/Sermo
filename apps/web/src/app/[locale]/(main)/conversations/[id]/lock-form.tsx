"use client";

import { useTranslations } from "next-intl";
import { setLockedAction } from "@/app/[locale]/(main)/conversations/actions";
import { ActionForm } from "@/components/forum/action-form";

// Locks the conversation, or opens it again when it is locked.
export function LockForm({
  conversationId,
  locked,
}: {
  conversationId: number;
  locked: boolean;
}) {
  const t = useTranslations("conversations.conversation");
  return (
    <ActionForm
      action={setLockedAction.bind(null, conversationId, !locked)}
      submit={t(locked ? "unlock.submit" : "lock.submit")}
      className="p-4"
    />
  );
}
