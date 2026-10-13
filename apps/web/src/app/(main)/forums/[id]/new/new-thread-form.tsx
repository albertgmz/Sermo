"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { findRecipients } from "@/app/(main)/conversations/actions";
import { createThreadAction } from "@/app/(main)/forums/actions";
import { AttachmentField } from "@/components/forum/attachment-field";
import { Editor } from "@/components/forum/editor";
import { FormFooter } from "@/components/forum/form-footer";
import { ThreadFields } from "@/components/forum/thread-fields";
import { useKeptForm } from "@/components/forum/use-kept-form";
import type { PrefixView } from "@/lib/sermo/views";

export function NewThreadForm({
  id,
  prefixes,
  canAttach,
}: {
  id: number;
  prefixes: PrefixView[];
  canAttach: boolean;
}) {
  const t = useTranslations("forums.newThreadForm");
  const { state, pending, onSubmit } = useKeptForm(
    createThreadAction.bind(null, id),
  );
  const [uploading, setUploading] = useState(false);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <ThreadFields
        prefixes={prefixes}
        prefixId={state.prefixId}
        title={state.title}
        placeholder={t("placeholder")}
      />
      <Editor name="body" minHeight={200} findMembers={findRecipients} />
      {canAttach && <AttachmentField nodeId={id} onBusy={setUploading} />}
      <FormFooter
        error={state.error}
        cancelHref={`/forums/${id}`}
        cancel={t("cancel")}
        submit={t("submit")}
        disabled={pending || uploading}
      />
    </form>
  );
}
