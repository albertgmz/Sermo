"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { editMessageAction } from "@/app/[locale]/(main)/conversations/actions";
import {
  type AttachedFile,
  AttachmentField,
} from "@/components/forum/attachment-field";
import { Toolbar } from "@/components/forum/editor-toolbar";
import { FormFooter } from "@/components/forum/form-footer";
import { LazyEditor } from "@/components/forum/lazy-editor";
import { findMentions } from "@/components/forum/mention-find";
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
      {/* The editor's code comes once the page is idle, or when the box is entered. */}
      <LazyEditor
        bar={Toolbar}
        name="body"
        compact={false}
        placeholder={tEditor("placeholder")}
        defaultValue={source}
        minHeight={200}
        findMembers={findMentions}
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
