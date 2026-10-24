"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { editMessageAction } from "@/app/[locale]/(main)/conversations/actions";
import type { PostEditFields } from "@/app/[locale]/(main)/threads/[id]/edit/[postId]/edit-data";
import {
  type EditDraft,
  takeEditDraft,
} from "@/app/[locale]/(main)/threads/[id]/edit/[postId]/edit-draft";
import {
  draftOf,
  type EditTarget,
} from "@/app/[locale]/(main)/threads/[id]/edit-target";
import { editPostAction } from "@/app/[locale]/(main)/threads/actions";
import { AttachmentField } from "@/components/forum/attachment-field";
import { Toolbar } from "@/components/forum/editor-toolbar";
import { FormFooter } from "@/components/forum/form-footer";
import { LazyEditor } from "@/components/forum/lazy-editor";
import { findMentions } from "@/components/forum/mention-find";
import { ThreadFields } from "@/components/forum/thread-fields";
import { useKeptForm } from "@/components/forum/use-kept-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// The edit page's form of a post, or of a conversation message, which XenForo edits with the same
// form: the thread's title row for an opening post, the text, the files, and a post's edit reason
// (a message has none).
export function EditPostForm({
  target,
  source,
  back,
  files,
  attached,
  thread,
}: PostEditFields & {
  target: EditTarget;
  // Where the post is in its thread, the message in its conversation.
  back: string;
}) {
  const t = useTranslations("threads.editForm");
  const tEditor = useTranslations("editor.editor");
  const { state, pending, onSubmit } = useKeptForm(
    target.kind === "post"
      ? editPostAction.bind(null, target.threadId, target.postId)
      : editMessageAction.bind(null, target.conversationId, target.messageId),
  );
  const [uploading, setUploading] = useState(false);
  // What the editor in the thread had when "More options" brought the member here: the form is
  // drawn again with it, once the page is on the screen (storage is not read while drawing, which
  // would differ from what the server drew).
  const [kept, setKept] = useState<EditDraft | null>(null);
  const draft = draftOf(target);
  useEffect(() => {
    // Taken once: a second run of the effect (React's development check) finds nothing.
    const taken = takeEditDraft(draft);
    if (taken) setKept(taken);
  }, [draft]);
  return (
    <form
      key={kept ? "kept" : "saved"}
      onSubmit={onSubmit}
      className="space-y-4"
    >
      {thread && (
        <>
          <ThreadFields
            prefixes={thread.prefixes}
            prefixId={kept?.prefixId ?? thread.prefixId}
            title={kept?.title ?? thread.title}
            mustHavePrefix={thread.mustHavePrefix}
          />
          <input type="hidden" name="titleWas" value={thread.title} />
          <input type="hidden" name="prefixWas" value={thread.prefixId} />
        </>
      )}
      {/* The editor's code comes once the page is idle, or when the box is entered. */}
      <LazyEditor
        bar={Toolbar}
        name="body"
        compact={false}
        placeholder={tEditor("placeholder")}
        defaultValue={kept?.body ?? source}
        minHeight={200}
        findMembers={findMentions}
      />
      {files && (
        <AttachmentField
          nodeId={files.nodeId}
          initial={kept?.attached ?? attached}
          onBusy={setUploading}
        />
      )}
      {target.kind === "post" && (
        <div className="space-y-2">
          <Label htmlFor="edit-reason" className="text-muted-foreground">
            {t("reasonLabel")}
          </Label>
          <Input id="edit-reason" name="reason" autoComplete="off" />
        </div>
      )}
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
