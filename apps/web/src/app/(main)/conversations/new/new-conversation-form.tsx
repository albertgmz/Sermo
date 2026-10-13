"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { startConversation } from "@/app/(main)/conversations/actions";
import { RecipientPicker } from "@/app/(main)/conversations/new/recipient-picker";
import { AttachmentField } from "@/components/forum/attachment-field";
import { Editor } from "@/components/forum/editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function NewConversationForm({
  preselected,
}: {
  preselected?: { id: number; username: string };
}) {
  const t = useTranslations("conversations.newConversationForm");
  const [state, action, pending] = useActionState(startConversation, {});
  const [uploading, setUploading] = useState(false);

  return (
    <form action={action} className="space-y-5">
      <RecipientPicker initial={preselected} />
      <div className="space-y-2">
        <Label htmlFor="conversation-title">{t("titleLabel")}</Label>
        <Input
          id="conversation-title"
          name="title"
          defaultValue={state.title}
          placeholder={t("titlePlaceholder")}
        />
      </div>
      <div className="space-y-2">
        <p className="text-sm leading-none font-medium">{t("messageLabel")}</p>
        <Editor name="body" placeholder={t("messagePlaceholder")} />
      </div>
      <AttachmentField onBusy={setUploading} />
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button
        type="submit"
        disabled={pending || uploading}
        className="h-10 px-4 md:h-8"
      >
        {t("submit")}
      </Button>
    </form>
  );
}
