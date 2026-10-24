"use client";

import { useTranslations } from "next-intl";
import { setThreadTagsAction } from "@/app/[locale]/(main)/threads/actions";
import {
  ActionForm,
  type ActionFormState,
} from "@/components/forum/action-form";
import { useInlinePanel } from "@/components/forum/inline-panel";
import { ThreadTagsField } from "@/components/forum/thread-tags-field";
import { Button } from "@/components/ui/button";
import { tagsToText } from "@/lib/sermo/tags";

// Changes the tags of a thread where they are read: the field with the whole list, saved at once.
// The thread's "•••" menu opens it under the thread's action row, for whoever `threads.get` says
// may edit them (`permissions.canEditTags`); it takes the focus, and saving, Cancel or Escape closes it (`onClose`, `useInlinePanel`).
export function ThreadTagsEditor({
  threadId,
  tags,
  onClose,
}: {
  threadId: number;
  tags: readonly string[];
  onClose: () => void;
}) {
  const t = useTranslations("forum.threadTags");
  const panel = useInlinePanel(onClose);
  const save = async (
    previous: ActionFormState,
    formData: FormData,
  ): Promise<ActionFormState> => {
    const state = await setThreadTagsAction(threadId, previous, formData);
    if (state.done) onClose();
    return state;
  };
  return (
    <div {...panel} className="w-full max-w-xl">
      <ActionForm
        action={save}
        submit={t("save")}
        variant="default"
        aside={
          <Button
            type="button"
            variant="ghost"
            className="h-10 px-3"
            onClick={onClose}
          >
            {t("cancel")}
          </Button>
        }
      >
        <ThreadTagsField defaultValue={tagsToText(tags)} />
      </ActionForm>
    </div>
  );
}
