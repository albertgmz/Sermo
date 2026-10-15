"use client";

import { Tag } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { setThreadTagsAction } from "@/app/[locale]/(main)/threads/actions";
import {
  ActionForm,
  type ActionFormState,
} from "@/components/forum/action-form";
import { ThreadTagsField } from "@/components/forum/thread-tags-field";
import { Button } from "@/components/ui/button";
import { tagsToText } from "@/lib/sermo/tags";

// Changes the tags of a thread where they are read: a button that opens the field and saves the
// whole list. Shown to whoever `threads.get` says may edit them (`permissions.canEditTags`).
export function ThreadTagsEditor({
  threadId,
  tags,
}: {
  threadId: number;
  tags: readonly string[];
}) {
  const t = useTranslations("forum.threadTags");
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        className="h-10 px-3 text-muted-foreground md:h-8"
        onClick={() => setOpen(true)}
      >
        <Tag aria-hidden="true" />
        {tags.length > 0 ? t("edit") : t("add")}
      </Button>
    );
  }
  const save = async (
    previous: ActionFormState,
    formData: FormData,
  ): Promise<ActionFormState> => {
    const state = await setThreadTagsAction(threadId, previous, formData);
    if (state.done) setOpen(false);
    return state;
  };
  return (
    <ActionForm
      action={save}
      submit={t("save")}
      variant="default"
      className="w-full max-w-xl"
      aside={
        <Button
          type="button"
          variant="ghost"
          className="h-10 px-3"
          onClick={() => setOpen(false)}
        >
          {t("cancel")}
        </Button>
      }
    >
      <ThreadTagsField defaultValue={tagsToText(tags)} />
    </ActionForm>
  );
}
