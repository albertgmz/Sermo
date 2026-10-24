"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
  type EditDraft,
  takeEditDraft,
} from "@/app/[locale]/(main)/threads/[id]/edit/[postId]/edit-draft";
import { editPostAction } from "@/app/[locale]/(main)/threads/actions";
import {
  type AttachedFile,
  AttachmentField,
} from "@/components/forum/attachment-field";
import { Toolbar } from "@/components/forum/editor-toolbar";
import { FormFooter } from "@/components/forum/form-footer";
import { LazyEditor } from "@/components/forum/lazy-editor";
import { findMentions } from "@/components/forum/mention-find";
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
  // The BB code the post was written in, as the backend keeps it.
  source: string;
  // Where the post is in its thread.
  back: string;
  // The forum to attach files in, when the viewer may attach files there.
  attachIn: number | null;
  attached: AttachedFile[];
  // The title and prefix of the thread, for the opening post when the viewer may change them.
  thread: {
    title: string;
    prefixId: string;
    prefixes: PrefixView[];
    mustHavePrefix: boolean;
  } | null;
}) {
  const t = useTranslations("threads.editForm");
  const tEditor = useTranslations("editor.editor");
  const { state, pending, onSubmit } = useKeptForm(
    editPostAction.bind(null, threadId, postId),
  );
  const [uploading, setUploading] = useState(false);
  // What the editor in the thread had when "More options" brought the member here: the form is
  // drawn again with it, once the page is on the screen (storage is not read while drawing, which
  // would differ from what the server drew).
  const [kept, setKept] = useState<EditDraft | null>(null);
  useEffect(() => {
    // Taken once: a second run of the effect (React's development check) finds nothing.
    const draft = takeEditDraft(postId);
    if (draft) setKept(draft);
  }, [postId]);
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
      {attachIn !== null && (
        <AttachmentField
          nodeId={attachIn}
          initial={kept?.attached ?? attached}
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
