"use client";

import { SendHorizontal } from "lucide-react";
import { useActionState } from "react";
import { replyAction } from "@/app/(main)/conversations/actions";
import { Editor } from "@/components/forum/editor";
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
  return (
    <form action={action} className={className}>
      {state.error && (
        <p role="alert" className="mb-2 text-sm text-destructive">
          {state.error}
        </p>
      )}
      <div className="flex items-end gap-2">
        <Editor
          compact
          name="body"
          placeholder={placeholder}
          className="flex-1"
        />
        <PendingButton size="icon" aria-label={submitLabel} className="size-10">
          <SendHorizontal />
        </PendingButton>
      </div>
    </form>
  );
}
