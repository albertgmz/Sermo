"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { QUOTE_EVENT } from "@/app/[locale]/(main)/threads/[id]/quote";
import { replyAction } from "@/app/[locale]/(main)/threads/actions";
import { replyInPlace } from "@/app/[locale]/(main)/threads/reply-in-place";
import { AttachmentField } from "@/components/forum/attachment-field";
import { ComposerButtons } from "@/components/forum/composer-buttons";
import { FormError } from "@/components/forum/form-error";
import { LazyEditor } from "@/components/forum/lazy-editor";
import { findMentions } from "@/components/forum/mention-find";
import { SelectionQuote } from "@/components/forum/selection-quote";
import { useTailForm } from "@/components/forum/use-tail-form";

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
    <>
      <form onSubmit={onSubmit} data-shortcut="reply" className="space-y-3">
        <LazyEditor
          key={`editor-${generation}`}
          name="body"
          compact={false}
          placeholder={t("placeholder")}
          findMembers={findMentions}
          insertEvent={QUOTE_EVENT}
        />
        {state.error && <FormError>{state.error}</FormError>}
        <ComposerButtons
          submitLabel={t("submit")}
          order="reply"
          disabled={pending || uploading}
          files={
            attachIn !== null && (
              <AttachmentField
                key={`files-${generation}`}
                compact
                nodeId={attachIn}
                onBusy={setUploading}
              />
            )
          }
        />
      </form>
      <SelectionQuote event={QUOTE_EVENT} />
    </>
  );
}
