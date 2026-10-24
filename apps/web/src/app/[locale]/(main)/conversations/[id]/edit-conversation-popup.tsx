"use client";

import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { editConversationClass } from "@/app/[locale]/(main)/conversations/[id]/edit-conversation-button";
import { editConversationAction } from "@/app/[locale]/(main)/conversations/actions";
import {
  EditDialog,
  EditDialogFooter,
  EditDialogSave,
  focusTitleAtEnd,
} from "@/components/forum/edit-dialog";
import { FormError } from "@/components/forum/form-error";
import { ThreadFields } from "@/components/forum/thread-fields";
import { useKeptForm } from "@/components/forum/use-kept-form";
import type { OpenedProps } from "@/components/ui/lazy-popup";

export type EditConversationPopupProps = {
  conversationId: number;
  // Null for what the viewer may not change: it is not in the form.
  title: string | null;
  locked: boolean | null;
  label: string;
  heading: string;
};

// XenForo's "Edit direct message": the title and "Lock direct message" with its hint, each sent
// only when it changed. The page is drawn again with what was saved (the heading, the badge, the
// reply form a lock takes away) at the address it is at; the dialog closes.
export function ConversationEditor({
  conversationId,
  title,
  locked,
  onDone,
}: {
  conversationId: number;
  title: string | null;
  locked: boolean | null;
  onDone: () => void;
}) {
  const t = useTranslations("conversations.conversation.edit");
  const form = useRef<HTMLFormElement>(null);
  const hint = useId();
  useEffect(() => focusTitleAtEnd(form.current), []);
  const { state, pending, onSubmit } = useKeptForm(async (previous, data) => {
    const saved = await editConversationAction(conversationId, previous, data);
    if (saved.error) return saved;
    onDone();
    return { done: true };
  });
  return (
    // `min-w-0`: an item of the dialog's grid, it keeps to a phone's width.
    <form ref={form} onSubmit={onSubmit} className="grid min-w-0 gap-4">
      {title !== null && (
        <>
          <ThreadFields prefixes={[]} title={title} />
          <input type="hidden" name="titleWas" value={title} />
        </>
      )}
      {locked !== null && (
        <>
          <label className="flex min-h-10 items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="locked"
              value="1"
              defaultChecked={locked}
              aria-describedby={hint}
              className="mt-0.5 size-4 shrink-0 accent-primary"
            />
            <span>
              {t("lock")}
              <span id={hint} className="block text-muted-foreground">
                {t("lockHint")}
              </span>
            </span>
          </label>
          <input type="hidden" name="lockedWas" value={locked ? "1" : ""} />
        </>
      )}
      {state.error && <FormError>{state.error}</FormError>}
      <EditDialogFooter>
        <EditDialogSave pending={pending} />
      </EditDialogFooter>
    </form>
  );
}

// The button and the dialog, which Base UI draws: loaded when the plain button of
// `EditConversationButton` is reached for, mounted open.
export default function EditConversationPopup({
  conversationId,
  title,
  locked,
  label,
  heading,
}: EditConversationPopupProps & OpenedProps) {
  const [open, setOpen] = useState(true);
  return (
    <EditDialog
      title={heading}
      trigger={
        <>
          <Pencil aria-hidden="true" />
          <span className="max-sm:sr-only">{label}</span>
        </>
      }
      triggerClassName={editConversationClass}
      open={open}
      onOpenChange={setOpen}
    >
      <ConversationEditor
        conversationId={conversationId}
        title={title}
        locked={locked}
        onDone={() => setOpen(false)}
      />
    </EditDialog>
  );
}
