"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import {
  editMessageAction,
  findRecipients,
} from "@/app/[locale]/(main)/conversations/actions";
import {
  type AttachedFile,
  AttachmentField,
} from "@/components/forum/attachment-field";
import { Editor } from "@/components/forum/editor";
import { FormFooter } from "@/components/forum/form-footer";
import { useKeptForm } from "@/components/forum/use-kept-form";

export function EditMessageForm({
  conversationId,
  messageId,
  source,
  back,
  attached,
}: {
  conversationId: number;
  messageId: number;
  // The Markdown the message was written in, as the backend keeps it.
  source: string;
  // Where the message is in its conversation.
  back: string;
  attached: AttachedFile[];
}) {
  const t = useTranslations("conversations.editForm");
  const { state, pending, onSubmit } = useKeptForm(
    editMessageAction.bind(null, conversationId, messageId),
  );
  const [uploading, setUploading] = useState(false);
  // The editor writes Markdown its own way: what the member did not touch is sent back as it was
  // kept (see the post edit form).
  const written = useRef<string>(undefined);
  const [body, setBody] = useState(source);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Editor
        defaultValue={source}
        minHeight={200}
        findMembers={findRecipients}
        onChange={(markdown) => {
          written.current ??= markdown;
          setBody(markdown === written.current ? source : markdown);
        }}
      />
      <input type="hidden" name="body" value={body} />
      <AttachmentField initial={attached} onBusy={setUploading} />
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
