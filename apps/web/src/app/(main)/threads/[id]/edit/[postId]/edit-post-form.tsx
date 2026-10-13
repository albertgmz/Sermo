"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { findRecipients } from "@/app/(main)/conversations/actions";
import { editPostAction } from "@/app/(main)/threads/actions";
import {
  type AttachedFile,
  AttachmentField,
} from "@/components/forum/attachment-field";
import { Editor } from "@/components/forum/editor";
import { FormFooter } from "@/components/forum/form-footer";
import { ThreadFields } from "@/components/forum/thread-fields";
import { useKeptForm } from "@/components/forum/use-kept-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PrefixView } from "@/lib/sermo/views";

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
  const { state, pending, onSubmit } = useKeptForm(
    editPostAction.bind(null, threadId, postId),
  );
  const [uploading, setUploading] = useState(false);
  // The editor writes Markdown its own way (it escapes an underscore, for one). What the member did
  // not touch is sent back as it was kept: the first thing the editor reports is how it writes the
  // source, and only a different text after that is a change.
  const written = useRef<string>(undefined);
  const [body, setBody] = useState(source);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {thread && (
        <>
          <ThreadFields
            prefixes={thread.prefixes}
            prefixId={thread.prefixId}
            title={thread.title}
          />
          <input type="hidden" name="titleWas" value={thread.title} />
          <input type="hidden" name="prefixWas" value={thread.prefixId} />
        </>
      )}
      <Editor
        defaultValue={source}
        minHeight={200}
        findMembers={findRecipients}
        onChange={(markdown) => {
          written.current ??= markdown;
          setBody(markdown === written.current ? source : markdown);
        }}
      />
      <input type="hidden" name="body" value={body} />
      {attachIn !== null && (
        <AttachmentField
          nodeId={attachIn}
          initial={attached}
          onBusy={setUploading}
        />
      )}
      <div className="space-y-2">
        <Label htmlFor="edit-reason" className="text-muted-foreground">
          {t("reasonLabel")}
        </Label>
        <Input id="edit-reason" name="reason" autoComplete="off" />
      </div>
      <FormFooter
        error={state.error}
        cancelHref={back}
        cancel={t("cancel")}
        submit={t("submit")}
        disabled={pending || uploading}
      />
    </form>
  );
}
