"use client";

import { Pencil, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import type { ThreadEditFields } from "@/app/[locale]/(main)/threads/[id]/edit/[postId]/edit-data";
import { editThreadClass } from "@/app/[locale]/(main)/threads/[id]/edit-thread-button";
import { showThreadHeading } from "@/app/[locale]/(main)/threads/[id]/thread-heading";
import {
  saveThreadInPlace,
  threadEditorAction,
} from "@/app/[locale]/(main)/threads/edit-in-place";
import { submitClass } from "@/components/forum/composer-buttons";
import { FormError } from "@/components/forum/form-error";
import { ThreadFields } from "@/components/forum/thread-fields";
import { useKeptForm } from "@/components/forum/use-kept-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { OpenedProps } from "@/components/ui/lazy-popup";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type EditThreadPopupProps = { threadId: number; label: string };

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
  // As XenForo's: the member is put in the title, at its end.
  useEffect(() => {
    if (!fields) return;
    const title = form.current?.querySelector<HTMLInputElement>(
      'input[name="title"]',
    );
    title?.focus();
    title?.setSelectionRange(title.value.length, title.value.length);
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

  const cancel = (
    <DialogClose render={<Button variant="outline" className="h-10 px-4" />}>
      {t("cancel")}
    </DialogClose>
  );
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
        <DialogFooter>
          {cancel}
          <Button
            type="button"
            variant="outline"
            className="h-10 px-4"
            onClick={() => setAsks((count) => count + 1)}
          >
            {t("retry")}
          </Button>
        </DialogFooter>
      </>
    );
  }
  return (
    <form ref={form} onSubmit={onSubmit} className="grid gap-4">
      <ThreadFields
        prefixes={fields.prefixes}
        prefixId={fields.prefixId}
        title={fields.title}
        mustHavePrefix={fields.mustHavePrefix}
      />
      <input type="hidden" name="titleWas" value={fields.title} />
      <input type="hidden" name="prefixWas" value={fields.prefixId} />
      {state.error && <FormError>{state.error}</FormError>}
      <DialogFooter>
        {cancel}
        <Button
          type="submit"
          disabled={pending}
          className={cn(submitClass, "h-10")}
        >
          <Save aria-hidden="true" />
          {t("save")}
        </Button>
      </DialogFooter>
    </form>
  );
}

// The button and the dialog of "Edit thread", which Base UI draws: loaded when the plain link of
// `EditThreadButton` is pressed, mounted open. What it opens with is asked for each time it opens.
export default function EditThreadPopup({
  threadId,
  label,
}: EditThreadPopupProps & OpenedProps) {
  const [open, setOpen] = useState(true);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className={editThreadClass}>
        <Pencil aria-hidden="true" />
        {label}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
        </DialogHeader>
        <ThreadEditor threadId={threadId} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
