"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { findRecipients } from "@/app/(main)/conversations/actions";
import { editPostAction } from "@/app/(main)/threads/actions";
import {
  type AttachedFile,
  AttachmentField,
} from "@/components/forum/attachment-field";
import { Editor } from "@/components/forum/editor";
import { ThreadFields } from "@/components/forum/thread-fields";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PrefixView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

export function EditPostForm({
  threadId,
  postId,
  source,
  back,
  attachIn,
  attached,
  thread,
}: {
  threadId: number;
  postId: number;
  // The Markdown the post was written in, as the backend keeps it.
  source: string;
  // Where the post is in its thread.
  back: string;
  // The forum to attach files in, when the viewer may attach files there.
  attachIn: number | null;
  attached: AttachedFile[];
  // The title and prefix of the thread, for the opening post when the viewer may change them.
  thread: { title: string; prefixId: string; prefixes: PrefixView[] } | null;
}) {
  const t = useTranslations("threads.editForm");
  const [state, action, pending] = useActionState(
    editPostAction.bind(null, threadId, postId),
    {},
  );
  return (
    <form action={action} className="space-y-4">
      {thread && (
        <ThreadFields
          prefixes={thread.prefixes}
          prefixId={thread.prefixId}
          title={thread.title}
        />
      )}
      <Editor
        name="body"
        defaultValue={source}
        minHeight={200}
        findMembers={findRecipients}
      />
      {attachIn !== null && (
        <AttachmentField nodeId={attachIn} initial={attached} />
      )}
      <div className="space-y-2">
        <Label htmlFor="edit-reason" className="text-muted-foreground">
          {t("reasonLabel")}
        </Label>
        <Input
          id="edit-reason"
          name="reason"
          maxLength={1000}
          autoComplete="off"
        />
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Link
          href={back}
          className={cn(buttonVariants({ variant: "outline" }), "h-10 px-4")}
        >
          {t("cancel")}
        </Link>
        <Button type="submit" disabled={pending} className="h-10 px-4">
          {t("submit")}
        </Button>
      </div>
    </form>
  );
}
