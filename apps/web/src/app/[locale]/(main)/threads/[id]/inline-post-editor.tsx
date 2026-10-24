"use client";

import { Save } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PostEditFields } from "@/app/[locale]/(main)/threads/[id]/edit/[postId]/edit-data";
import { keepEditDraft } from "@/app/[locale]/(main)/threads/[id]/edit/[postId]/edit-draft";
import { postEditHref } from "@/app/[locale]/(main)/threads/[id]/pages";
import {
  EDITOR_HEIGHT,
  EditorPlaceholder,
  type SavedPost,
} from "@/app/[locale]/(main)/threads/[id]/post-edit-scope";
import { showThreadHeading } from "@/app/[locale]/(main)/threads/[id]/thread-heading";
import {
  postEditorAction,
  savePostInPlace,
} from "@/app/[locale]/(main)/threads/edit-in-place";
import type { AttachedFile } from "@/components/forum/attachment-field";
import { AttachmentField } from "@/components/forum/attachment-field";
import { submitClass } from "@/components/forum/composer-buttons";
import { Toolbar } from "@/components/forum/editor-toolbar";
import { FormError } from "@/components/forum/form-error";
import { LazyEditor } from "@/components/forum/lazy-editor";
import { findMentions } from "@/components/forum/mention-find";
import { ThreadFields } from "@/components/forum/thread-fields";
import { useKeptForm } from "@/components/forum/use-kept-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const buttonClass = "h-11 rounded-[9px] px-5 text-(length:--text-compact)";

// What the editor of a post opens with, once asked: the fields, or why they could not be had.
type Opened = { fields: PostEditFields } | { error: string };

// The editor that takes the place of a post's text while it is edited in place, as XenForo's quick
// edit: the title row of an opening post, the text in the editor (its box and bar at once, Lexical
// once the page is idle or the text entered), the files, then Save, "More options…" (the edit page,
// with what was written here) and Cancel. It asks for the post's BB code when it opens (the page
// holds only the drawn text) and puts the member at the end of it.
export default function InlinePostEditor({
  threadId,
  postId,
  canQuote,
  onClose,
}: {
  threadId: number;
  postId: number;
  canQuote: boolean;
  onClose: (saved?: SavedPost) => void;
}) {
  const t = useTranslations("forum.inPlaceEdit");
  const tEditor = useTranslations("editor.editor");
  const [opened, setOpened] = useState<Opened | null>(null);
  const [asks, setAsks] = useState(0);
  const [uploading, setUploading] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  // The files as the editor lists them now, for "More options" to carry.
  const files = useRef<AttachedFile[] | null>(null);
  const listFiles = useCallback((listed: AttachedFile[]) => {
    files.current = listed;
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `asks` asks again (Try again).
  useEffect(() => {
    let current = true;
    setOpened(null);
    postEditorAction(threadId, postId).then(
      (answer) => current && setOpened(answer),
      () => current && setOpened({ error: "" }),
    );
    return () => {
      current = false;
    };
  }, [threadId, postId, asks]);

  const fields = opened && "fields" in opened ? opened.fields : null;
  // The member is put at the end of the text, as XenForo's quick edit does; entering the box
  // brings Lexical, which keeps the caret.
  useEffect(() => {
    if (!fields) return;
    const box = form.current?.querySelector<HTMLTextAreaElement>(
      'textarea[name="body"]',
    );
    if (!box) return;
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  }, [fields]);

  const { state, pending, onSubmit } = useKeptForm(async (_previous, data) => {
    const saved = await savePostInPlace(threadId, postId, canQuote, data);
    // A title saved before a refused post is the thread's now, either way.
    if (saved.thread && fields?.thread) {
      showThreadHeading(threadId, fields.thread.title, saved.thread);
    }
    if ("error" in saved) return { error: saved.error };
    onClose({ body: saved.body, edited: saved.edited });
    return { done: true };
  });

  const cancel = (
    <Button
      type="button"
      variant="ghost"
      className={buttonClass}
      onClick={() => onClose()}
    >
      {t("cancel")}
    </Button>
  );

  if (!opened) return <EditorPlaceholder />;
  if (!fields) {
    return (
      <div className="space-y-2">
        <FormError>
          {("error" in opened && opened.error) || t("failed")}
        </FormError>
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            type="button"
            variant="outline"
            className={buttonClass}
            onClick={() => setAsks((count) => count + 1)}
          >
            {t("retry")}
          </Button>
          {cancel}
        </div>
      </div>
    );
  }
  return (
    <form
      ref={form}
      onSubmit={onSubmit}
      aria-label={t("editing")}
      className="space-y-3"
    >
      {fields.thread && (
        <>
          <ThreadFields
            prefixes={fields.thread.prefixes}
            prefixId={fields.thread.prefixId}
            title={fields.thread.title}
            mustHavePrefix={fields.thread.mustHavePrefix}
          />
          <input type="hidden" name="titleWas" value={fields.thread.title} />
          <input
            type="hidden"
            name="prefixWas"
            value={fields.thread.prefixId}
          />
        </>
      )}
      <LazyEditor
        bar={Toolbar}
        name="body"
        compact={false}
        placeholder={tEditor("placeholder")}
        defaultValue={fields.source}
        minHeight={EDITOR_HEIGHT}
        findMembers={findMentions}
      />
      {fields.attachIn !== null && (
        <AttachmentField
          nodeId={fields.attachIn}
          initial={fields.attached}
          onBusy={setUploading}
          onFiles={listFiles}
        />
      )}
      {state.error && <FormError>{state.error}</FormError>}
      {/* XenForo's quick edit puts its buttons in the middle under the editor. */}
      <div className="flex flex-wrap justify-center gap-2">
        <Button
          type="submit"
          disabled={pending || uploading}
          className={submitClass}
        >
          <Save aria-hidden="true" />
          {t("save")}
        </Button>
        <Link
          href={postEditHref(threadId, postId)}
          onClick={() => {
            if (form.current) {
              keepEditDraft(postId, new FormData(form.current), files.current);
            }
          }}
          className={cn(buttonVariants({ variant: "outline" }), buttonClass)}
        >
          {t("moreOptions")}
        </Link>
        {cancel}
      </div>
    </form>
  );
}
