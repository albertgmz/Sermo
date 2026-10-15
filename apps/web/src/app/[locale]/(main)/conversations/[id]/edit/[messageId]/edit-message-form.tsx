"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  editMessageAction,
  findRecipients,
} from "@/app/[locale]/(main)/conversations/actions";
import {
  type AttachedFile,
  AttachmentField,
} from "@/components/forum/attachment-field";
import { FormFooter } from "@/components/forum/form-footer";
import { LazyEditor } from "@/components/forum/lazy-editor";
import { useKeptForm } from "@/components/forum/use-kept-form";

export function EditMessageForm({
  conversationId,
  messageId,
  source,
  back,
  attached,
  canAttach = true,
}: {
  conversationId: number;
  messageId: number;
  // The BB code the message was written in, as the backend keeps it.
  source: string;
  // Where the message is in its conversation.
  back: string;
  attached: AttachedFile[];
  // Whether the viewer's groups allow adding files (`conversation.attach`); kept ones stay.
  canAttach?: boolean;
}) {
  const t = useTranslations("conversations.editForm");
  const tEditor = useTranslations("editor.editor");
  const { state, pending, onSubmit } = useKeptForm(
    editMessageAction.bind(null, conversationId, messageId),
  );
  const [uploading, setUploading] = useState(false);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {/* The editor's code is asked for when the member goes to write in the box. */}
      <LazyEditor
        name="body"
        compact={false}
        placeholder={tEditor("placeholder")}
        defaultValue={source}
        minHeight={200}
        findMembers={findRecipients}
      />
      {(canAttach || attached.length > 0) && (
        <AttachmentField initial={attached} onBusy={setUploading} />
      )}
      <FormFooter
        error={state.error}
        cancelHref={back}
        cancel={t("cancel")}
        submit={t("submit")}
        disabled={pending || uploading}
      />
    </form>
  );
}
