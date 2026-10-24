"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import type { ThreadEditFields } from "@/app/[locale]/(main)/threads/[id]/edit/[postId]/edit-data";
import { showThreadHeading } from "@/app/[locale]/(main)/threads/[id]/thread-heading";
import {
  saveThreadInPlace,
  threadEditorAction,
} from "@/app/[locale]/(main)/threads/edit-in-place";
import {
  EditDialog,
  EditDialogFooter,
  EditDialogSave,
  focusTitleAtEnd,
} from "@/components/forum/edit-dialog";
import { FormError } from "@/components/forum/form-error";
import { ThreadFields } from "@/components/forum/thread-fields";
import { useKeptForm } from "@/components/forum/use-kept-form";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export type EditThreadPopupProps = {
  threadId: number;
  label: string;
  onClose: () => void;
};

type Opened = { fields: ThreadEditFields } | { error: string };

// The thread's title and prefix, asked for when the dialog opens (it opens with them as they are
// now), saved in place: the heading shows them at once, and nothing else is drawn again.
function ThreadEditor({
  threadId,
  onDone,
}: {
  threadId: number;
  onDone: () => void;
}) {
  const t = useTranslations("forum.inPlaceEdit");
  const [opened, setOpened] = useState<Opened | null>(null);
  const [asks, setAsks] = useState(0);
  const form = useRef<HTMLFormElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `asks` asks again (Try again).
  useEffect(() => {
    let current = true;
    setOpened(null);
    threadEditorAction(threadId).then(
      (answer) => current && setOpened(answer),
      () => current && setOpened({ error: "" }),
    );
    return () => {
      current = false;
    };
  }, [threadId, asks]);

  const fields = opened && "fields" in opened ? opened.fields : null;
  useEffect(() => {
    if (fields) focusTitleAtEnd(form.current);
  }, [fields]);

  const { state, pending, onSubmit } = useKeptForm(async (_previous, data) => {
    const saved = await saveThreadInPlace(threadId, data);
    if ("error" in saved) return { error: saved.error };
    if (saved.heading && fields) {
      showThreadHeading(threadId, fields.title, saved.heading);
    }
    onDone();
    return { done: true };
  });

  // The title row's room while it is asked for.
  if (!opened) {
    return (
      <div aria-busy="true" className="space-y-2">
        <Skeleton className="h-4 w-12" />
        <Skeleton className="h-10 w-full md:h-8" />
      </div>
    );
  }
  if (!fields) {
    return (
      <>
        <FormError>
          {("error" in opened && opened.error) || t("failed")}
        </FormError>
        <EditDialogFooter>
          <Button
            type="button"
            variant="outline"
            className="h-10 px-4"
            onClick={() => setAsks((count) => count + 1)}
          >
            {t("retry")}
          </Button>
        </EditDialogFooter>
      </>
    );
  }
  return (
    // `min-w-0`: an item of the dialog's grid, it may be narrower than what it holds, so it keeps
    // to a phone's width.
    <form ref={form} onSubmit={onSubmit} className="grid min-w-0 gap-4">
      <ThreadFields
        prefixes={fields.prefixes}
        prefixId={fields.prefixId}
        title={fields.title}
        mustHavePrefix={fields.mustHavePrefix}
      />
      <input type="hidden" name="titleWas" value={fields.title} />
      <input type="hidden" name="prefixWas" value={fields.prefixId} />
      {state.error && <FormError>{state.error}</FormError>}
      <EditDialogFooter>
        <EditDialogSave pending={pending} />
      </EditDialogFooter>
    </form>
  );
}

// The dialog of "Edit thread", which Base UI draws: loaded when the thread's "•••" menu first offers
// it, mounted open. What it opens with is asked for each time it opens; closing it (Cancel, Escape,
// a press outside, a save) calls `onClose`.
export default function EditThreadPopup({
  threadId,
  label,
  onClose,
}: EditThreadPopupProps) {
  return (
    <EditDialog
      title={label}
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <ThreadEditor threadId={threadId} onDone={onClose} />
    </EditDialog>
  );
}
