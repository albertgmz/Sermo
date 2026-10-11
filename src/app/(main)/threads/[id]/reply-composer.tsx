"use client";

import { Paperclip, Send } from "lucide-react";
import { useActionState } from "react";
import { replyAction } from "@/app/(main)/threads/actions";
import { Editor } from "@/components/forum/editor";
import { Button } from "@/components/ui/button";

export function ReplyComposer({ threadId }: { threadId: number }) {
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
          Attach files
        </Button>
        <Button
          type="submit"
          aria-label="Post reply"
          disabled={pending}
          className="h-10 w-12"
        >
          <Send className="size-5" />
        </Button>
      </div>
    </form>
  );
}
