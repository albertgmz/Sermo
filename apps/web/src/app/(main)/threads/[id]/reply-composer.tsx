"use client";

import { Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { findRecipients } from "@/app/(main)/conversations/actions";
import { QUOTE_EVENT } from "@/app/(main)/threads/[id]/quote";
import { replyAction } from "@/app/(main)/threads/actions";
import { AttachmentField } from "@/components/forum/attachment-field";
import { Editor } from "@/components/forum/editor";
import { Button } from "@/components/ui/button";

export function ReplyComposer({
  threadId,
  attachIn,
}: {
  threadId: number;
  // The forum to attach files in, when the viewer may attach files there.
  attachIn: number | null;
}) {
  const t = useTranslations("threads.replyComposer");
  const [state, action, pending] = useActionState(
    replyAction.bind(null, threadId),
    {},
  );
  return (
    <form action={action} className="space-y-3">
      <Editor
        name="body"
        findMembers={findRecipients}
        insertEvent={QUOTE_EVENT}
      />
      {attachIn !== null && <AttachmentField nodeId={attachIn} />}
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button
          type="submit"
          aria-label={t("aria.submit")}
          disabled={pending}
          className="h-10 w-12"
        >
          <Send className="size-5" />
        </Button>
      </div>
    </form>
  );
}
