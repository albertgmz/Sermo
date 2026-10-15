"use client";

import { Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { findRecipients } from "@/app/[locale]/(main)/conversations/actions";
import type { PostRowContext } from "@/app/[locale]/(main)/threads/[id]/post-item";
import { QUOTE_EVENT } from "@/app/[locale]/(main)/threads/[id]/quote";
import { replyAction } from "@/app/[locale]/(main)/threads/actions";
import { replyInPlace } from "@/app/[locale]/(main)/threads/reply-in-place";
import { AttachmentField } from "@/components/forum/attachment-field";
import { Editor } from "@/components/forum/editor";
import { FormError } from "@/components/forum/form-error";
import { useTailForm } from "@/components/forum/use-tail-form";
import { Button } from "@/components/ui/button";

export function ReplyComposer({
  threadId,
  tailKey,
  rowContext,
  attachIn,
}: {
  threadId: number;
  // Where the end of the last page is kept while it is open, and what drawing a post there needs
  // to know of the thread.
  tailKey: string;
  rowContext: PostRowContext;
  // The forum to attach files in, when the viewer may attach files there.
  attachIn: number | null;
}) {
  const t = useTranslations("threads.replyComposer");
  const tFailed = useTranslations("lib.errors");
  // A reply that is taken shows at the end of the page at once and the form starts over; a refused
  // one stays in the form.
  const { state, pending, generation, onSubmit } = useTailForm({
    tailKey,
    send: replyInPlace.bind(null, threadId, rowContext),
    redirecting: replyAction.bind(null, threadId),
    failed: tFailed("generic"),
  });
  const [uploading, setUploading] = useState(false);
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Editor
        key={generation}
        name="body"
        findMembers={findRecipients}
        insertEvent={QUOTE_EVENT}
      />
      {attachIn !== null && (
        <AttachmentField
          key={generation}
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
