"use client";

import { SendHorizontal } from "lucide-react";
import { useActionState, useState } from "react";
import { replyAction } from "@/app/(main)/conversations/actions";
import { AttachmentField } from "@/components/forum/attachment-field";
import { LazyEditor } from "@/components/forum/lazy-editor";
import { PendingButton } from "@/components/forum/pending-button";

export function ReplyForm({
  conversationId,
  placeholder,
  submitLabel,
  className,
}: {
  conversationId: number;
  placeholder: string;
  submitLabel: string;
  className?: string;
}) {
  const [state, action] = useActionState(
    replyAction.bind(null, conversationId),
    {},
  );
  const [uploading, setUploading] = useState(false);
  return (
    <form action={action} className={className}>
      {state.error && (
        <p role="alert" className="mb-2 text-sm text-destructive">
          {state.error}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <AttachmentField compact onBusy={setUploading} />
        <LazyEditor
          name="body"
          placeholder={placeholder}
          className="flex-1 rounded-4xl"
        />
        <PendingButton
          size="icon"
          aria-label={submitLabel}
          disabled={uploading}
          className="size-10"
        >
          <SendHorizontal />
        </PendingButton>
      </div>
    </form>
  );
}
