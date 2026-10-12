"use client";

import { Paperclip, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { replyAction } from "@/app/(main)/threads/actions";
import { Editor } from "@/components/forum/editor";
import { Button } from "@/components/ui/button";

export function ReplyComposer({ threadId }: { threadId: number }) {
  const t = useTranslations("threads.replyComposer");
  const [state, action, pending] = useActionState(
    replyAction.bind(null, threadId),
    {},
  );
  return (
    <form action={action} className="space-y-3">
      <Editor name="body" />
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="outline" className="h-10 px-3">
          <Paperclip />
          {t("attach")}
        </Button>
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
