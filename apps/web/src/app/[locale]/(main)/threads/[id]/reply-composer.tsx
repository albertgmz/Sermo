"use client";

import { Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { findRecipients } from "@/app/[locale]/(main)/conversations/actions";
import { QUOTE_EVENT } from "@/app/[locale]/(main)/threads/[id]/quote";
import { replyAction } from "@/app/[locale]/(main)/threads/actions";
import { replyInPlace } from "@/app/[locale]/(main)/threads/reply-in-place";
import { AttachmentField } from "@/components/forum/attachment-field";
import { FormError } from "@/components/forum/form-error";
import { LazyEditor } from "@/components/forum/lazy-editor";
import { useTailForm } from "@/components/forum/use-tail-form";
import { Button } from "@/components/ui/button";

export function ReplyComposer({
  threadId,
  tailKey,
  attachIn,
}: {
  threadId: number;
  // Where the end of the last page is kept while it is open.
  tailKey: string;
  // The forum to attach files in, when the viewer may attach files there.
  attachIn: number | null;
}) {
  const t = useTranslations("threads.replyComposer");
  const tFailed = useTranslations("lib.errors");
  const tEditor = useTranslations("editor.editor");
  // A reply that is taken shows at the end of the page at once and the form starts over; a refused
  // one stays in the form.
  const { state, pending, generation, onSubmit } = useTailForm({
    tailKey,
    send: replyInPlace.bind(null, threadId),
    redirecting: replyAction.bind(null, threadId),
    failed: tFailed("generic"),
  });
  const [uploading, setUploading] = useState(false);
  return (
    <form onSubmit={onSubmit} data-shortcut="reply" className="space-y-3">
      <LazyEditor
        key={`editor-${generation}`}
        name="body"
        compact={false}
        placeholder={tEditor("placeholder")}
        findMembers={findRecipients}
        insertEvent={QUOTE_EVENT}
      />
      {attachIn !== null && (
        <AttachmentField
          key={`files-${generation}`}
          nodeId={attachIn}
          onBusy={setUploading}
        />
      )}
      {state.error && <FormError>{state.error}</FormError>}
      <div className="flex items-center justify-end gap-2">
        <Button
          type="submit"
          aria-label={t("aria.submit")}
          disabled={pending || uploading}
          className="h-10 w-12"
        >
          <Send className="size-5" />
        </Button>
      </div>
    </form>
  );
}
