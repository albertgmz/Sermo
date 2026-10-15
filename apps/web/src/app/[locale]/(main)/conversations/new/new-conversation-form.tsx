"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { startConversation } from "@/app/[locale]/(main)/conversations/actions";
import { RecipientPicker } from "@/app/[locale]/(main)/conversations/new/recipient-picker";
import { AttachmentField } from "@/components/forum/attachment-field";
import { FormError } from "@/components/forum/form-error";
import { LazyEditor } from "@/components/forum/lazy-editor";
import { useKeptForm } from "@/components/forum/use-kept-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function NewConversationForm({
  preselected,
  canAttach = true,
}: {
  preselected?: { id: number; username: string };
  // Whether the viewer's groups allow attaching files to messages (`conversation.attach`).
  canAttach?: boolean;
}) {
  const t = useTranslations("conversations.newConversationForm");
  // A refused conversation stays in the form, files included: the form is not reset by its action.
  const { state, pending, onSubmit } = useKeptForm(startConversation);
  const [uploading, setUploading] = useState(false);

  return (
    <form onSubmit={onSubmit} className="space-y-5">
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
        <LazyEditor
          name="body"
          compact={false}
          placeholder={t("messagePlaceholder")}
        />
      </div>
      {canAttach && <AttachmentField onBusy={setUploading} />}
      {state.error && <FormError>{state.error}</FormError>}
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
